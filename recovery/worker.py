"""Motor privado de recuperación. No acepta rutas, SQL ni destinos desde la API."""
import contextlib
import datetime
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import uuid

ROOT = Path(os.environ.get('RECOVERY_DIR', '/recovery'))
ASSETS = Path(os.environ.get('ASSET_DIR', '/assets'))
DB = os.environ.get('PGDATABASE', 'k13group')
SECRET = os.environ['RECOVERY_SECRET'].encode()
MAX_BYTES = int(os.environ.get('BACKUP_MAX_BYTES', str(2 * 1024**3)))
SCHEDULE_QUERY = "SELECT coalesce(json_object_agg(clave,valor),'{}') FROM public.configuracion WHERE clave IN ('copias.automaticas_activas','copias.intervalo_horas','copias.conservar')"
UUID = re.compile(r'^[0-9a-f-]{36}$')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    with open(tmp, 'w') as f:
        json.dump(value, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path):
    return json.loads(path.read_text())


def sign(value):
    return hmac.new(SECRET, value.encode(), hashlib.sha256).hexdigest()


def checksum(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def command(args, database=None, sql=None):
    env = dict(os.environ, PGDATABASE=database or DB, PGCONNECT_TIMEOUT='10')
    # Nunca publicar stderr: puede contener datos o detalles privados de conexión.
    result = subprocess.run(args, input=sql, text=True, capture_output=True,
                            env=env, timeout=600, check=False)
    if result.returncode:
        raise RuntimeError('Falló una herramienta de PostgreSQL; operación detenida.')
    return result.stdout.strip()


def query(sql, database=None):
    return command(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], database, sql)


def migrations(database=None):
    return json.loads(query('SELECT coalesce(json_agg(migration_name ORDER BY migration_name),\'[]\') FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL', database))


def digest(database):
    tables = json.loads(query("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sesiones','actividad','copias_seguridad')", database))
    result = {}
    for table in tables:
        if not re.fullmatch(r'[a-zA-Z_][a-zA-Z_0-9]*', table):
            raise RuntimeError('Esquema no compatible.')
        result[table] = query(f'''SELECT count(*)::text || ':' || md5(coalesce(string_agg(h, '' ORDER BY h), '')) FROM (SELECT md5(row_to_json(t)::text) h FROM public."{table}" t) hashes''', database)
    return result


@contextlib.contextmanager
def temporary_database(dump):
    name = 'k13_recovery_' + uuid.uuid4().hex
    journal=ROOT / 'work' / (name + '.database')
    atomic(journal, {'database':name})
    query(f'CREATE DATABASE "{name}"', 'postgres')
    try:
        command(['pg_restore', '--clean', '--if-exists', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-d', name, str(dump)], name)
        yield name
    finally:
        query(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', 'postgres')
        journal.unlink(missing_ok=True)


def space():
    size = int(query('SELECT pg_database_size(current_database())'))
    if shutil.disk_usage(ROOT).free < max(512 * 1024**2, size * 3):
        raise RuntimeError('Espacio insuficiente para una recuperación segura.')


def backup(automatic=False, actor=None, scheduled=False):
    space()
    ident = str(uuid.uuid4())
    with tempfile.TemporaryDirectory(dir=ROOT / 'work') as folder:
        folder = Path(folder)
        dump = folder / 'database.dump'
        command(['pg_dump', '-Fc', '--no-owner', '--no-acl', '--schema=public', '--exclude-table-data=public.sesiones', '-f', str(dump)])
        if dump.stat().st_size > MAX_BYTES:
            raise RuntimeError('La copia supera el límite de tamaño.')
        with temporary_database(dump) as temp:
            manifest = {'format': 1, 'id': ident, 'createdAt': now(), 'actor': actor, 'migrations': migrations(temp), 'digest': digest(temp), 'files': {'database.dump': checksum(dump)}}
            logo = query("SELECT valor FROM public.configuracion WHERE clave='negocio.logo_asset_id'", temp)
            if logo:
                if not UUID.fullmatch(logo):
                    raise RuntimeError('Logo inválido en la configuración.')
                src = ASSETS / (logo + '.webp')
                shutil.copyfile(src, folder / (logo + '.webp'))
                manifest['files'][logo + '.webp'] = checksum(src)
        atomic(folder / 'manifest.json', manifest)
        target = ROOT / 'copies' / (ident + '.tar')
        partial = target.with_suffix('.partial')
        with tarfile.open(partial, 'w') as archive:
            for path in folder.iterdir():
                archive.add(path, arcname=path.name, recursive=False)
        if partial.stat().st_size > MAX_BYTES:
            partial.unlink()
            raise RuntimeError('La copia supera el límite de tamaño.')
        with open(partial, 'rb') as f:
            os.fsync(f.fileno())
        os.replace(partial, target)
        meta = {'id': ident, 'state': 'COMPLETADA', 'size': str(target.stat().st_size), 'createdAt': manifest['createdAt'], 'checksum': checksum(target), 'automatic': automatic, 'actor': actor, 'migrations': manifest['migrations']}
        meta['mac'] = sign(ident + ':' + meta['checksum'])
        meta['scheduled'] = scheduled
        atomic(target.with_suffix('.json'), meta)
        return ident


@contextlib.contextmanager
def validated(ident):
    if not UUID.fullmatch(ident):
        raise RuntimeError('Identificador inválido.')
    target = ROOT / 'copies' / (ident + '.tar')
    meta = read(target.with_suffix('.json'))
    if meta['state'] != 'COMPLETADA' or not hmac.compare_digest(meta.get('mac', ''), sign(ident + ':' + meta['checksum'])):
        raise RuntimeError('Metadatos de copia inválidos.')
    if not target.is_file() or target.stat().st_size > MAX_BYTES or checksum(target) != meta['checksum']:
        raise RuntimeError('Copia ausente, corrupta o demasiado grande.')
    with tempfile.TemporaryDirectory(dir=ROOT / 'work') as folder:
        folder = Path(folder)
        with tarfile.open(target, 'r') as archive:
            members = archive.getmembers()
            names = [m.name for m in members]
            if len(names) != len(set(names)) or sum(m.size for m in members) > MAX_BYTES:
                raise RuntimeError('Archivo de copia inválido.')
            for m in members:
                if not m.isfile() or not (m.name in ('manifest.json', 'database.dump') or re.fullmatch(r'[0-9a-f-]{36}\.webp', m.name)):
                    raise RuntimeError('Contenido de copia no permitido.')
                with archive.extractfile(m) as source, open(folder / m.name, 'wb') as dest:
                    shutil.copyfileobj(source, dest)
        manifest = read(folder / 'manifest.json')
        if manifest['format'] != 1 or manifest['id'] != ident or manifest['migrations'] != migrations():
            raise RuntimeError('La copia pertenece a otra versión del esquema.')
        if set(names) != {'manifest.json', *manifest['files']}:
            raise RuntimeError('Manifiesto incompleto.')
        for name, expected in manifest['files'].items():
            if checksum(folder / name) != expected:
                raise RuntimeError('Checksum de contenido incorrecto.')
        with temporary_database(folder / 'database.dump') as temp:
            if migrations(temp) != manifest['migrations'] or digest(temp) != manifest['digest']:
                raise RuntimeError('No se ha podido verificar la igualdad de los datos.')
            query('SELECT count(*) FROM public.usuarios', temp)
        meta['validatedAt'] = now()
        atomic(target.with_suffix('.json'), meta)
        yield folder, manifest


def apply(folder, manifest):
    for name in manifest['files']:
        if name.endswith('.webp'):
            shutil.copyfile(folder / name, ASSETS / name)
    # El SQL de pg_restore y la revocación son UNA transacción. Sin ventana de
    # reactivación de sesiones, incluso si el trabajador cae después del COMMIT.
    sqlfile = folder / 'restore.sql'
    command(['pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '-f', str(sqlfile), str(folder / 'database.dump')])
    with open(sqlfile, 'a') as f:
        f.write('\nDELETE FROM public.sesiones;\n')
    command(['psql', '-X', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-f', str(sqlfile)])
    if digest(DB) != manifest['digest']:
        raise RuntimeError('La verificación posterior a la restauración ha fallado.')


def phase(job, value, **extra):
    job.update(phase=value, **extra)
    atomic(ROOT / 'jobs' / (job['id'] + '.json'), job)


def audit(job):
    actor = job.get('actor')
    actor_sql = f"(SELECT id FROM public.usuarios WHERE id='{actor}')" if actor and UUID.fullmatch(actor) else 'NULL'
    details = json.dumps({'trabajo': job['id'], 'resultado': job['state'], 'copia': job.get('copyId'), 'actorOriginal': actor}).replace("'", "''")
    query(f"INSERT INTO public.actividad(id,usuario_id,tabla,registro_id,accion,datos_nuevos) VALUES ('{uuid.uuid4()}',{actor_sql},'copias_seguridad','{job['id']}','{job['action'].upper()}','{details}'::jsonb)")



def reconcile():
    """Proyección de inventario; la autoridad permanece fuera de la base restaurada."""
    for path in (ROOT / 'copies').glob('*.json'):
        meta=read(path)
        ident=meta['id']
        if not UUID.fullmatch(ident):
            continue
        if meta['state']=='ELIMINADA':
            query(f"DELETE FROM public.copias_seguridad WHERE id='{ident}'")
        elif meta['state']=='COMPLETADA':
            query(f"INSERT INTO public.copias_seguridad(id,archivo,tamano,estado_id,created_at) SELECT '{ident}','{ident}.tar',{int(meta['size'])},id,'{meta['createdAt']}'::timestamp FROM public.estados WHERE tipo='copia_seguridad' AND valor='COMPLETADA' ON CONFLICT(id) DO UPDATE SET archivo=EXCLUDED.archivo,tamano=EXCLUDED.tamano,estado_id=EXCLUDED.estado_id")


def rollback(job):
    phase(job, 'Recuperando copia previa')
    with validated(job['safetyId']) as (folder, manifest):
        apply(folder, manifest)
    reconcile()


def execute(job):
    try:
        phase(job, 'Iniciando', state='EJECUTANDO')
        action = job['action']
        if action == 'backup':
            phase(job, 'Creando y comprobando copia')
            job['copyId'] = backup(actor=job.get('actor'), automatic=bool(job.get('scheduled')), scheduled=bool(job.get('scheduled')))
        elif action == 'delete':
            ident = job['copyId']
            # Marcar primero: nunca permitir descargar un archivo eliminado.
            path = ROOT / 'copies' / (ident + '.json')
            meta = read(path)
            meta['state'] = 'ELIMINADA'
            atomic(path, meta)
            (ROOT / 'copies' / (ident + '.tar')).unlink(missing_ok=True)
        elif action in ('validate', 'restore'):
            phase(job, 'Validando en una base temporal')
            with validated(job['copyId']) as (folder, manifest):
                if action == 'restore':
                    space()
                    # Marcador durable antes de drenar. Las leases existentes se
                    # esperan; ninguna lease nueva supera el segundo chequeo API.
                    atomic(ROOT / 'maintenance', {'job': job['id']})
                    phase(job, 'Esperando operaciones en curso')
                    deadline = time.monotonic() + 90
                    while any((ROOT / 'leases').iterdir()):
                        if time.monotonic() > deadline:
                            raise RuntimeError('No se han detenido todas las operaciones; no se ha sustituido la base.')
                        time.sleep(.2)
                    phase(job, 'Creando copia previa obligatoria')
                    job['safetyId'] = backup(automatic=True, actor=job.get('actor'))
                    with validated(job['safetyId']):
                        pass
                    # Persistir ANTES de modificar: un reinicio siempre revierte.
                    phase(job, 'Restaurando', replacing=True)
                    apply(folder, manifest)
                    phase(job, 'Comprobando base recuperada')
                    query('SELECT 1')
        else:
            raise RuntimeError('Operación no permitida.')
        reconcile()
        job['state']='COMPLETADA'
        audit(job)
        phase(job, 'Completada', state='COMPLETADA', replacing=False, finishedAt=now())
        if action == 'restore':
            (ROOT / 'maintenance').unlink(missing_ok=True)
    except Exception as error:
        # Publicar solo mensajes propios; nunca salidas SQL/rutas/credenciales.
        message = str(error) if type(error) is RuntimeError else 'La operación ha fallado; revisa la disponibilidad y el archivo de copia.'
        if job.get('replacing'):
            try:
                rollback(job)
                job['replacing'] = False
                message += ' Se ha recuperado la copia previa.'
            except Exception:
                message = 'Recuperación previa pendiente. Mantenimiento activo; ejecuta ./dev recovery-resume.'
        elif job['action'] == 'restore':
            (ROOT / 'maintenance').unlink(missing_ok=True)
        phase(job, 'Fallida', state='FALLIDA', error=message, finishedAt=now())
        if job['action']=='restore' and not job.get('replacing'):
            (ROOT / 'maintenance').unlink(missing_ok=True)
        try:
            audit(job)
        except Exception:
            pass


def recover_interrupted():
    for path in sorted((ROOT / 'jobs').glob('*.json')):
        job = read(path)
        if job.get('replacing'):
            try:
                rollback(job)
                phase(job, 'Copia previa recuperada tras interrupción', state='FALLIDA', replacing=False, error='Restauración interrumpida; se recuperó la copia previa.', finishedAt=now())
                (ROOT / 'maintenance').unlink(missing_ok=True)
            except Exception:
                phase(job, 'Recuperación previa pendiente', state='FALLIDA', error='Mantenimiento activo; recuperación de emergencia necesaria.')
        elif job['state'] == 'EJECUTANDO':
            if job['action'] == 'restore':
                (ROOT / 'maintenance').unlink(missing_ok=True)
            phase(job, 'Interrumpida antes de sustituir datos', state='FALLIDA', finishedAt=now())
        elif job['state'] == 'COMPLETADA' and job['action'] == 'restore' and (ROOT / 'maintenance').exists():
            if read(ROOT / 'maintenance').get('job') == job['id']:
                (ROOT / 'maintenance').unlink()
    # Completar la limpieza interrumpida. Solo el trabajador con flock publica
    # archivos; ningún .tar sin metadatos puede pertenecer a un trabajo activo aquí.
    for path in (ROOT / 'copies').glob('*.tar'):
        metadata = path.with_suffix('.json')
        if not metadata.exists() or read(metadata)['state'] == 'ELIMINADA':
            path.unlink()
    try:
        reconcile()
    except Exception:
        # La recuperación debe poder arrancar incluso si la base necesita reparación.
        pass
    for path in (ROOT / 'copies').glob('*.partial'):
        path.unlink()
    # No hay proceso ejecutando comandos tras reiniciar este contenedor.
    for path in (ROOT / 'work').iterdir():
        if path.is_dir():
            shutil.rmtree(path)
        elif path.suffix=='.database' and re.fullmatch(r'k13_recovery_[a-f0-9]{32}',path.stem):
            query(f'DROP DATABASE IF EXISTS "{path.stem}" WITH (FORCE)', 'postgres')
            path.unlink()
    stale = ROOT / 'dispatch.lock'
    if stale.exists() and time.time() - stale.stat().st_mtime > 120:
        shutil.rmtree(stale)


def enqueue(action, ident=None):
    if action == 'restore':
        if input(f'Escribe {ident} para sustituir la base y cerrar todas las sesiones: ') != ident:
            raise RuntimeError('Confirmación incorrecta.')
    lock = ROOT / 'dispatch.lock'
    lock.mkdir()
    try:
        if any(read(p)['state'] in ('PENDIENTE', 'EJECUTANDO') for p in (ROOT / 'jobs').glob('*.json')):
            raise RuntimeError('Ya existe una operación en curso.')
        jobid = str(uuid.uuid4())
        payload = json.dumps({'id': jobid, 'action': action, 'actor': None, 'copyId': ident, 'issued': int(time.time() * 1000)})
        atomic(ROOT / 'jobs' / (jobid + '.json'), {'id': jobid, 'action': action, 'copyId': ident, 'state': 'PENDIENTE', 'phase': 'En cola', 'createdAt': now()})
        atomic(ROOT / 'jobs' / (jobid + '.request'), {'payload': payload, 'mac': sign(payload)})
        print(jobid, flush=True)
    finally:
        lock.rmdir()
    while True:
        job = read(ROOT / 'jobs' / (jobid + '.json'))
        if job['state'] in ('COMPLETADA', 'FALLIDA'):
            print(json.dumps({k: job.get(k) for k in ('id', 'state', 'phase', 'copyId', 'error')}, ensure_ascii=False))
            return 0 if job['state'] == 'COMPLETADA' else 1
        time.sleep(1)


def schedule_tick(timestamp=None):
    """Bajo el flock del worker: una copia pendiente y limpieza reintentable.

    El inventario durable evita duplicar copias al reiniciar. La limpieza tiene
    su propio estado: un fallo no obliga a crear otra copia ni a esperar un día.
    """
    timestamp = time.time() if timestamp is None else timestamp
    started = time.monotonic()
    path = ROOT / 'schedule.json'
    state = {}
    try:
        saved = read(path) if path.exists() else {}
        if not isinstance(saved, dict):
            raise RuntimeError('Estado de programación inválido.')
        state = saved
        # En una instalación nueva el worker puede arrancar antes de migrar la API.
        if not query("SELECT coalesce(to_regclass('public.configuracion')::text, '')"):
            return
        values = json.loads(query(SCHEDULE_QUERY))
        enabled = values.get('copias.automaticas_activas', '0') == '1'
        hours, keep = int(values.get('copias.intervalo_horas', '24')), int(values.get('copias.conservar', '7'))
        if not 1 <= hours <= 168 or not 1 <= keep <= 90:
            raise RuntimeError('Configuración de copias inválida.')
        if not enabled or timestamp < state.get('retryAt', 0):
            return
        copies = [read(p) for p in (ROOT / 'copies').glob('*.json')]
        scheduled = sorted([c for c in copies if c.get('scheduled') and c['state'] == 'COMPLETADA'], key=lambda c: c['createdAt'], reverse=True)
        anchor = next((c for c in scheduled if c['id'] == state.get('retentionPending')), None)
        if state.get('retentionPending') and not anchor:
            # La copia que autorizaba limpiar pudo eliminarse manualmente.
            state.pop('retentionPending', None)
            atomic(path, state)
        last = datetime.datetime.fromisoformat(scheduled[0]['createdAt']).timestamp() if scheduled else 0
        if not anchor and timestamp < last + hours * 3600:
            return
        if (ROOT / 'maintenance').exists():
            return
        lock = ROOT / 'dispatch.lock'
        try:
            lock.mkdir()
        except FileExistsError:
            return
        try:
            if any(read(p)['state'] in ('PENDIENTE', 'EJECUTANDO') for p in (ROOT / 'jobs').glob('*.json')):
                return
            if not anchor:
                job = {'id': str(uuid.uuid4()), 'action': 'backup', 'actor': None,
                       'scheduled': True, 'state': 'PENDIENTE', 'phase': 'Programada', 'createdAt': now()}
                atomic(ROOT / 'jobs' / (job['id'] + '.json'), job)
                execute(job)
                state = {'lastJob': job['id'], 'state': job['state'], 'finishedAt': now(),
                         'error': job.get('error'), 'retryAt': timestamp + time.monotonic() - started + 900 if job['state'] != 'COMPLETADA' else 0}
                if job['state'] == 'COMPLETADA':
                    state['retentionPending'] = job['copyId']
                atomic(path, state)
                if job['state'] != 'COMPLETADA':
                    return
                anchor = read(ROOT / 'copies' / (job['copyId'] + '.json'))
                scheduled = [anchor, *scheduled]
            # Crear/validar una copia puede tardar: releer la política justo antes
            # de limpiar, por si se amplió la conservación o se desactivó mientras.
            current = json.loads(query(SCHEDULE_QUERY))
            keep = int(current.get('copias.conservar', '7'))
            if not 1 <= keep <= 90:
                raise RuntimeError('Conservación inválida.')
            if current.get('copias.automaticas_activas', '0') != '1':
                state.pop('retentionPending', None)
                state.update(state='COMPLETADA', error=None, retryAt=0, finishedAt=now())
                atomic(path, state)
                return
            # No eliminar ninguna copia si la que habilitó esta limpieza se dañó.
            ident = anchor['id']
            if not UUID.fullmatch(ident) or not hmac.compare_digest(anchor.get('mac', ''), sign(ident + ':' + anchor['checksum'])) or checksum(ROOT / 'copies' / (ident + '.tar')) != anchor['checksum']:
                raise RuntimeError('La copia nueva no está disponible para conservar el respaldo.')
            # Se usa la política vigente también al reintentar una limpieza.
            for old in scheduled[keep:]:
                if not UUID.fullmatch(old['id']) or not hmac.compare_digest(old.get('mac', ''), sign(old['id'] + ':' + old['checksum'])):
                    raise RuntimeError('No se puede aplicar la conservación a metadatos inválidos.')
                cleanup = {'id': str(uuid.uuid4()), 'action': 'delete', 'copyId': old['id'],
                           'actor': None, 'state': 'PENDIENTE', 'phase': 'Conservación programada', 'createdAt': now()}
                execute(cleanup)
                if cleanup['state'] != 'COMPLETADA':
                    raise RuntimeError('La copia se creó, pero falló la limpieza de copias antiguas.')
            state.pop('retentionPending', None)
            state.update(state='COMPLETADA', error=None, retryAt=0, finishedAt=now())
            atomic(path, state)
        finally:
            lock.rmdir()
    except Exception:
        try:
            atomic(path, {**state, 'state': 'FALLIDA', 'error': 'No se pudo completar la programación de copias. Revisa el servicio de recuperación.',
                          'finishedAt': now(), 'retryAt': timestamp + time.monotonic() - started + 900})
        except Exception:
            # Un disco lleno tampoco debe matar el proceso que permite recuperar.
            print('No se pudo guardar el estado de programación; revisa el almacenamiento.', file=sys.stderr, flush=True)


def main():
    os.umask(0o077)
    for path in (ROOT, ROOT / 'jobs', ROOT / 'copies', ROOT / 'leases', ROOT / 'work', ASSETS):
        path.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 1 and sys.argv[1] != 'resume':
        return enqueue(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    with open(ROOT / 'worker.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        recover_interrupted()
        def heartbeat():
            while True:
                (ROOT / 'heartbeat').touch()
                time.sleep(2)
        threading.Thread(target=heartbeat, daemon=True).start()
        last_schedule_check = 0
        while True:
            for request in sorted((ROOT / 'jobs').glob('*.request')):
                job = None
                try:
                    envelope = read(request)
                    if not hmac.compare_digest(envelope['mac'], sign(envelope['payload'])):
                        raise RuntimeError('Autorización inválida.')
                    payload = json.loads(envelope['payload'])
                    if not UUID.fullmatch(payload['id']) or request.stem != payload['id']:
                        raise RuntimeError('Identificador inválido.')
                    job = read(request.with_suffix('.json'))
                    if job['state'] != 'PENDIENTE':
                        request.unlink()
                        continue
                    if abs(time.time() * 1000 - payload['issued']) > 300000:
                        raise RuntimeError('Autorización caducada. Solicita de nuevo la operación.')
                    if payload.get('copyId') and not UUID.fullmatch(payload['copyId']):
                        raise RuntimeError('Identificador de copia inválido.')
                    if (ROOT / 'maintenance').exists():
                        raise RuntimeError('Mantenimiento pendiente de recuperación.')
                    if payload.get('checksum') and read(ROOT / 'copies' / (payload['copyId'] + '.json'))['checksum'] != payload['checksum']:
                        raise RuntimeError('La copia ha cambiado desde la autorización.')
                    job.update(action=payload['action'], actor=payload.get('actor'), copyId=payload.get('copyId'))
                    execute(job)
                except Exception:
                    if job and job['state'] == 'PENDIENTE':
                        phase(job, 'Autorización inválida o caducada', state='FALLIDA', finishedAt=now())
                finally:
                    request.unlink(missing_ok=True)
            stale = ROOT / 'dispatch.lock'
            if stale.exists() and time.time() - stale.stat().st_mtime > 120:
                shutil.rmtree(stale)
            for path in (ROOT / 'jobs').glob('*.json'):
                if time.time() - path.stat().st_mtime > 120 and not path.with_suffix('.request').exists():
                    job=read(path)
                    if job['state']=='PENDIENTE':
                        phase(job, 'Solicitud interrumpida', state='FALLIDA', finishedAt=now())
            if time.monotonic() - last_schedule_check >= 30:
                schedule_tick()
                last_schedule_check = time.monotonic()
            time.sleep(1)


if __name__ == '__main__':
    sys.exit(main())

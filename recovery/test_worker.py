"""Ensayos destructivos limitados a una BD ficticia con nombre generado.
Ejecutar con ./dev test-recovery. Nunca restaura la base de trabajo.
"""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

spec=importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
w=importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

class RecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=w.DB
        cls.database='k13_recovery_test_'+uuid.uuid4().hex
        w.query(f'CREATE DATABASE "{cls.database}"', 'postgres')
        cls.addClassCleanup(lambda: w.query(f'DROP DATABASE IF EXISTS "{cls.database}" WITH (FORCE)', 'postgres'))
        w.DB=cls.database
        cls.root=tempfile.TemporaryDirectory(prefix='k13-recovery-test-')
        w.ROOT=Path(cls.root.name)
        w.ASSETS=w.ROOT/'assets'
        for path in [w.ROOT/'copies',w.ROOT/'jobs',w.ROOT/'leases',w.ROOT/'work',w.ASSETS]:path.mkdir()
        # Esquema real, con todas las migraciones; datos exclusivamente ficticios.
        w.query('CREATE TABLE _prisma_migrations(migration_name text, finished_at timestamp, rolled_back_at timestamp)')
        for migration in sorted(Path('/migrations').glob('*/migration.sql')):
            w.query(migration.read_text())
            w.query(f"INSERT INTO _prisma_migrations VALUES ('{migration.parent.name}',now(),NULL)")
        cls.user=str(uuid.uuid4());cls.logo=str(uuid.uuid4())
        w.query(f"INSERT INTO usuarios(id,username,nombre,password_hash,updated_at) VALUES ('{cls.user}','ficticio','Datos de ensayo','irrelevante',now())")
        cls.state=str(uuid.uuid4())
        w.query(f"INSERT INTO estados(id,tipo,valor,etiqueta) VALUES ('{cls.state}','copia_seguridad','COMPLETADA','Completada')")
        w.query(f"INSERT INTO configuracion(id,clave,valor) VALUES ('{uuid.uuid4()}','negocio.nombre','Antes'),('{uuid.uuid4()}','negocio.logo_asset_id','{cls.logo}')")
        # Tabla adicional prueba decimales, fecha, claves externas y unicode.
        w.query(f"CREATE TABLE ensayo_financiero(id uuid PRIMARY KEY, usuario_id uuid REFERENCES usuarios(id), importe decimal(10,2), fecha date, snapshot jsonb); INSERT INTO ensayo_financiero VALUES ('{uuid.uuid4()}','{cls.user}',1234.56,'2024-02-29','{{\"nombre\":\"Ñandú histórico\"}}')")
        # Las decisiones 12.3 y su versión deben sobrevivir al mismo backup y restore.
        analysis=str(uuid.uuid4())
        w.query(f"INSERT INTO importaciones(id,archivo,usuario_id,estado,version_mapeo,version_equivalencias) VALUES ('{analysis}','ensayo.xlsx','{cls.user}','EN_REVISION','12.1.0',1)")
        w.query(f"INSERT INTO importacion_equivalencias_revision(id,importacion_id,version,tipo,alcance,clave,accion,origen,dependencias,autor,motivo,solicitud_id,solicitud_hash) VALUES ('{uuid.uuid4()}','{analysis}',1,'PAGO','VALOR','{'a'*64}','PENDIENTE','{{\"origen\":\"STR\"}}','{{}}','{cls.user}','Pendiente de revisión','{uuid.uuid4()}','{'b'*64}')")
        # El recibo de un lote aplicado también debe sobrevivir a la restauración.
        cls.batch=str(uuid.uuid4())
        w.query(f"INSERT INTO importacion_lotes(id,importacion_id,autor,solicitud_id,solicitud_hash,huella,seleccion,propuesta,resultado,estado,motivo,aplicado_at) VALUES ('{cls.batch}','{analysis}','{cls.user}','{uuid.uuid4()}','{'c'*64}','{'d'*64}','{{}}','{{}}','{{\"filas\":[]}}','APLICADO','Ensayo de recibo persistente',now())")
        (w.ASSETS/(cls.logo+'.webp')).write_bytes(b'fixture-image-bytes')
        cls.copy=w.backup()
        cls.before=w.digest(w.DB)

    @classmethod
    def tearDownClass(cls):
        assert cls.database.startswith('k13_recovery_test_')
        w.query(f'DROP DATABASE "{cls.database}" WITH (FORCE)', 'postgres')
        w.DB=cls.original
        cls.root.cleanup()

    def setUp(self):
        self.assertTrue(w.DB.startswith('k13_recovery_test_'))
        (w.ROOT/'maintenance').unlink(missing_ok=True)
        for p in (w.ROOT/'jobs').iterdir():p.unlink()
        with w.validated(self.copy) as (folder,manifest):w.apply(folder,manifest)

    def job(self,action='restore'):
        return {'id':str(uuid.uuid4()),'action':action,'copyId':self.copy,'actor':self.user,'state':'PENDIENTE','phase':'En cola','createdAt':w.now()}

    def test_01_snapshot_validated_with_equal_business_data_and_logo(self):
        with w.validated(self.copy) as (folder,manifest):
            self.assertEqual(manifest['digest'],self.before)
            self.assertEqual((folder/(self.logo+'.webp')).read_bytes(),b'fixture-image-bytes')
        self.assertIn('validatedAt',w.read(w.ROOT/'copies'/(self.copy+'.json')))

    def test_02_full_restore_revokes_sessions_and_reconciles_inventory(self):
        w.query("UPDATE configuracion SET valor='Después' WHERE clave='negocio.nombre'")
        w.query(f"INSERT INTO sesiones(id,usuario_id,token,expires_at) VALUES ('{uuid.uuid4()}','{self.user}','token-ficticio',now()+interval '1 day')")
        job=self.job();w.execute(job)
        self.assertEqual(job['state'],'COMPLETADA',job.get('error'))
        self.assertEqual(w.digest(w.DB),self.before)
        self.assertEqual(w.query('SELECT count(*) FROM sesiones'),'0')
        self.assertEqual(w.query(f"SELECT estado FROM importacion_lotes WHERE id='{self.batch}'"),'APLICADO')
        self.assertFalse((w.ROOT/'maintenance').exists())
        self.assertTrue(job['safetyId'])
        self.assertGreaterEqual(int(w.query('SELECT count(*) FROM copias_seguridad')),2)

    def test_03_postrestore_failure_rolls_back_previous_data(self):
        w.query("UPDATE configuracion SET valor='Preservar al fallar' WHERE clave='negocio.nombre'")
        previous=w.digest(w.DB);original=w.apply;calls=0
        def fail_once(folder,manifest):
            nonlocal calls
            calls+=1;original(folder,manifest)
            if calls==1:raise RuntimeError('Fallo simulado tras sustitución')
        with patch.object(w,'apply',side_effect=fail_once):
            job=self.job();w.execute(job)
        self.assertEqual(job['state'],'FALLIDA')
        self.assertEqual(w.digest(w.DB),previous)
        self.assertFalse((w.ROOT/'maintenance').exists())

    def test_04_crash_after_commit_recovers_prior_backup_on_restart(self):
        w.query("UPDATE configuracion SET valor='Antes de la caída' WHERE clave='negocio.nombre'")
        previous=w.digest(w.DB);safety=w.backup(automatic=True)
        job=self.job();w.phase(job,'Restaurando',state='EJECUTANDO',replacing=True,safetyId=safety)
        w.atomic(w.ROOT/'maintenance',{'job':job['id']})
        with w.validated(self.copy) as (folder,manifest):w.apply(folder,manifest)
        w.recover_interrupted()
        self.assertEqual(w.digest(w.DB),previous)
        self.assertFalse((w.ROOT/'maintenance').exists())
        self.assertEqual(w.read(w.ROOT/'jobs'/(job['id']+'.json'))['state'],'FALLIDA')

    def test_05_failed_rollback_keeps_maintenance_until_resume(self):
        w.query("UPDATE configuracion SET valor='Debe recuperarse' WHERE clave='negocio.nombre'")
        previous=w.digest(w.DB)
        with patch.object(w,'apply',side_effect=RuntimeError('Fallo de almacenamiento simulado')):
            job=self.job();w.execute(job)
        self.assertTrue((w.ROOT/'maintenance').exists())
        self.assertTrue(job['replacing'])
        w.recover_interrupted()
        self.assertFalse((w.ROOT/'maintenance').exists())
        self.assertEqual(w.digest(w.DB),previous)

    def test_06_missing_corrupt_and_incompatible_archives_rejected(self):
        target=w.ROOT/'copies'/(self.copy+'.tar');original=target.read_bytes()
        try:
            target.unlink()
            with self.assertRaises((RuntimeError,FileNotFoundError)):
                with w.validated(self.copy):pass
            target.write_bytes(original+b'corruption')
            with self.assertRaises(RuntimeError):
                with w.validated(self.copy):pass
            target.write_bytes(original)
            with patch.object(w,'migrations',return_value=['other-version']):
                with self.assertRaises(RuntimeError):
                    with w.validated(self.copy):pass
        finally:target.write_bytes(original)
        self.assertEqual(w.digest(w.DB),self.before)

    def test_07_low_space_and_failed_safety_copy_never_replace_database(self):
        previous=w.digest(w.DB)
        with patch.object(w,'space',side_effect=RuntimeError('Espacio insuficiente')):
            job=self.job();w.execute(job)
        self.assertEqual(job['state'],'FALLIDA');self.assertEqual(w.digest(w.DB),previous)
        with patch.object(w,'backup',side_effect=RuntimeError('Falló copia previa')):
            job=self.job();w.execute(job)
        self.assertFalse((w.ROOT/'maintenance').exists());self.assertEqual(w.digest(w.DB),previous)

    def test_08_delete_retains_metadata_and_prevents_validation(self):
        ident=w.backup();job=self.job('delete');job['copyId']=ident;w.execute(job)
        self.assertEqual(job['state'],'COMPLETADA',job.get('error'))
        self.assertEqual(w.read(w.ROOT/'copies'/(ident+'.json'))['state'],'ELIMINADA')
        self.assertFalse((w.ROOT/'copies'/(ident+'.tar')).exists())
        with self.assertRaises(RuntimeError):
            with w.validated(ident):pass

    def test_09_restart_finishes_interrupted_delete_and_removes_orphan_files(self):
        ident=w.backup();w.reconcile()
        meta=w.read(w.ROOT/'copies'/(ident+'.json'))
        meta['state']='ELIMINADA'
        w.atomic(w.ROOT/'copies'/(ident+'.json'),meta)
        orphan=w.ROOT/'copies'/(str(uuid.uuid4())+'.tar')
        orphan.write_bytes(b'unpublished archive')
        partial=orphan.with_suffix('.partial');partial.write_bytes(b'incomplete')
        w.recover_interrupted()
        self.assertFalse((w.ROOT/'copies'/(ident+'.tar')).exists())
        self.assertFalse(orphan.exists())
        self.assertFalse(partial.exists())
        self.assertEqual(w.query(f"SELECT count(*) FROM copias_seguridad WHERE id='{ident}'"),'0')
        self.assertTrue((w.ROOT/'copies'/(self.copy+'.tar')).exists())

if __name__=='__main__':unittest.main(verbosity=2)

'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMe } from '@/modules/auth/hooks/use-auth';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import {
  fetchSettings,
  settingsKey,
  useDateLabel,
  type Settings,
  type SettingsResponse,
} from '@/modules/configuracion/preferences';
import { Backups } from '@/modules/configuracion/backups';

const selectClass = 'w-full rounded-input border border-hover bg-background p-2';
const panels = {
  general: 'General',
  catalogos: 'Catálogos',
  seguridad: 'Seguridad',
  copias: 'Copias',
  sistema: 'Sistema',
};
function SettingsPage() {
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p role="status">Cargando configuración…</p>;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Configuración</h1>
        <p className="text-text-secondary">Ajustes del negocio, cuenta y recuperación de datos.</p>
      </header>
      <nav aria-label="Secciones de configuración" className="flex flex-wrap gap-3">
        {Object.entries(panels).map(([key, label]) => (
          <Link
            key={key}
            href={`/configuracion?tab=${key}`}
            aria-current={tab === key ? 'page' : undefined}
            className={`rounded-button border px-4 py-2 ${tab === key ? 'bg-primary text-white' : 'border-hover'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'catalogos' ? (
        <CatalogLinks />
      ) : tab === 'seguridad' ? (
        <Account />
      ) : tab === 'copias' ? (
        <Backups />
      ) : tab === 'sistema' ? (
        <>
          <SettingsEditor technical />
          <System />
          <History />
        </>
      ) : (
        <SettingsEditor />
      )}
    </div>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p>Cargando configuración…</p>}>
      <SettingsPage />
    </Suspense>
  );
}
function SettingsEditor({ technical = false }: { technical?: boolean }) {
  const query = useQuery({ queryKey: settingsKey, queryFn: fetchSettings });
  if (query.isPending) return <p role="status">Cargando ajustes…</p>;
  if (!query.data)
    return (
      <div role="alert">
        No se pueden cargar los ajustes.{' '}
        <Button onClick={() => void query.refetch()}>Reintentar</Button>
      </div>
    );
  return (
    <SettingsForm
      key={String(technical)}
      initial={query.data}
      latest={query.data}
      technical={technical}
    />
  );
}
const generalFields: { key: keyof Settings; label: string; min?: number; max?: number }[] = [
  { key: 'negocio.nombre', label: 'Nombre del negocio' },
  { key: 'suscripciones.dias_proxima', label: 'Días de próxima renovación', min: 1, max: 365 },
];
const technicalFields: typeof generalFields = [
  {
    key: 'sistema.intervalo_comprobacion_minutos',
    label: 'Comprobar estados y avisos cada (minutos)',
    min: 1,
    max: 60,
  },
  {
    key: 'interfaz.refresco_indicadores_segundos',
    label: 'Refrescar indicadores cada (segundos)',
    min: 15,
    max: 300,
  },
  { key: 'seguridad.access_minutos', label: 'Duración del acceso (minutos)', min: 5, max: 60 },
  {
    key: 'seguridad.sesion_dias',
    label: 'Duración máxima de nuevas sesiones (días)',
    min: 1,
    max: 30,
  },
];
function SettingsForm({
  initial,
  latest,
  technical,
}: {
  initial: SettingsResponse;
  latest: SettingsResponse;
  technical: boolean;
}) {
  const cache = useQueryClient();
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial.valores);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fields = technical ? technicalFields : generalFields;
  const editable = technical
    ? fields.map((f) => f.key)
    : ([
        ...fields.map((f) => f.key),
        'interfaz.formato_fecha',
        'interfaz.resultados_pagina',
      ] as (keyof Settings)[]);
  const changes = Object.fromEntries(
    editable.filter((key) => draft[key] !== base.valores[key]).map((key) => [key, draft[key]]),
  );
  const dirty = Object.keys(changes).length > 0;
  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (
      technical &&
      !window.confirm(
        'Aplicar estos parámetros a las próximas comprobaciones y emisiones de tokens. Las sesiones existentes conservarán su vencimiento absoluto.',
      )
    )
      return;
    if (
      'suscripciones.dias_proxima' in changes &&
      !window.confirm(
        'Cambiar el umbral actualizará estados y avisos del periodo actual. No cambiará vencimientos ni cobros.',
      )
    )
      return;
    setPending(true);
    try {
      const result = await api.patch<{ data: SettingsResponse }>('/configuracion', {
        version: base.version,
        motivo: reason,
        cambios: changes,
        ...(technical ? { password } : {}),
      });
      setBase(result.data.data);
      setDraft(result.data.data.valores);
      setReason('');
      setPassword('');
      cache.setQueryData(settingsKey, result.data.data);
      await cache.invalidateQueries();
      setNotice('Ajustes guardados.');
    } catch (e) {
      setError(catalogError(e));
      void cache.invalidateQueries({ queryKey: settingsKey });
    } finally {
      setPassword('');
      setPending(false);
    }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const data = new FormData();
      data.set('file', file);
      data.set('version', String(base.version));
      data.set('motivo', reason);
      const result = await api.post<{ data: SettingsResponse }>('/configuracion/logo', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBase(result.data.data);
      setDraft((old) => ({
        ...result.data.data.valores,
        ...Object.fromEntries(editable.map((key) => [key, old[key]])),
      }));
      setFile(null);
      cache.setQueryData(settingsKey, result.data.data);
      await cache.invalidateQueries();
      setNotice('Logo guardado.');
    } catch (e) {
      setError(catalogError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="rounded-card border-hover bg-panel space-y-5 border p-5">
      <h2 className="font-semibold">
        {technical ? 'Parámetros del sistema' : 'Ajustes generales'}
      </h2>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      {latest.version !== base.version && (
        <p role="alert">
          Hay una versión más reciente. Tu borrador se conserva.{' '}
          <Button
            variant="secondary"
            onClick={() => {
              if (window.confirm('Descartar el borrador y cargar los ajustes actuales?')) {
                setBase(latest);
                setDraft(latest.valores);
                setError('');
              }
            }}
          >
            Recargar ajustes
          </Button>
        </p>
      )}
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type={f.min === undefined ? 'text' : 'number'}
              min={f.min}
              max={f.max}
              maxLength={150}
              required
              value={draft[f.key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [f.key]: f.min === undefined ? e.target.value : Number(e.target.value),
                })
              }
            />
          ))}
          {!technical && (
            <>
              <label>
                Formato de fecha
                <select
                  className={selectClass}
                  value={draft['interfaz.formato_fecha']}
                  onChange={(e) => setDraft({ ...draft, 'interfaz.formato_fecha': e.target.value })}
                >
                  <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                  <option value="yyyy-MM-dd">yyyy-MM-dd</option>
                </select>
              </label>
              <label>
                Resultados por página
                <select
                  className={selectClass}
                  value={draft['interfaz.resultados_pagina']}
                  onChange={(e) =>
                    setDraft({ ...draft, 'interfaz.resultados_pagina': Number(e.target.value) })
                  }
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <Input
            label="Motivo del cambio"
            minLength={3}
            maxLength={1000}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {technical && (
            <Input
              label="Contraseña actual para aplicar parámetros"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </fieldset>
        <Button loading={pending} disabled={!dirty} type="submit">
          Guardar ajustes
        </Button>
        {!dirty && <span className="text-text-secondary ml-3 text-sm">Sin cambios pendientes</span>}
      </form>
      {!technical ? (
        <>
          <p className="text-text-secondary text-sm">
            EUR · Español · Europe/Madrid. Servicio anual: renovación anticipada desde el
            vencimiento y tardía desde la renovación del servicio.
          </p>
          <form onSubmit={upload} className="border-hover space-y-3 border-t pt-4">
            <Input
              label="Logo del negocio"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              hint="PNG, JPEG o WebP; hasta 2 MB. Usa el motivo indicado arriba."
            />
            <Button
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={!file || reason.trim().length < 3}
            >
              Guardar logo
            </Button>
          </form>
        </>
      ) : (
        <p className="text-text-secondary text-sm">
          Las duraciones se aplican a nuevas emisiones. Las sesiones ya creadas mantienen su
          vencimiento absoluto. Puedes cerrarlas todas desde Seguridad.
        </p>
      )}
    </section>
  );
}
function CatalogLinks() {
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {[
        ['productos', 'Productos y tarifas'],
        ['tarifas', 'Tarifas'],
        ['servidores', 'Servidores'],
        ['referencias', 'Referencias'],
        ['metodos-pago', 'Métodos de pago'],
        ['categorias-gasto', 'Categorías de gasto'],
      ].map(([key, label]) => (
        <Link
          className="rounded-card border-hover bg-panel text-primary border p-5"
          key={key}
          href={`/catalogos?tab=${key}`}
        >
          {label} →
        </Link>
      ))}
    </section>
  );
}
function Account() {
  const me = useMe();
  if (!me.data) return <p role="status">Cargando perfil…</p>;
  return <AccountForm initial={me.data} />;
}
function AccountForm({ initial }: { initial: NonNullable<ReturnType<typeof useMe>['data']> }) {
  const cache = useQueryClient();
  const dateLabel = useDateLabel();
  const [user, setUser] = useState(initial);
  const [name, setName] = useState(initial.nombre);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(action: 'profile' | 'password' | 'logout', event?: FormEvent) {
    event?.preventDefault();
    setError('');
    setNotice('');
    if (
      action !== 'profile' &&
      !window.confirm('Esta acción cerrará todas las sesiones, incluida la actual. ¿Continuar?')
    )
      return;
    if (action === 'password' && (next !== confirm || new TextEncoder().encode(next).length > 72)) {
      setError('La confirmación debe coincidir y la contraseña no puede superar 72 bytes UTF-8.');
      return;
    }
    setPending(true);
    try {
      if (action === 'profile') {
        const result = await api.patch('/users/me', {
          nombre: name,
          username,
          password,
          version: user.updatedAt,
        });
        setUser(result.data.data);
        await cache.invalidateQueries({ queryKey: ['auth', 'me'] });
        setNotice('Perfil actualizado.');
      } else {
        await api.post(
          action === 'password' ? '/users/me/password' : '/auth/logout-all',
          action === 'password' ? { password, nueva: next, confirmacion: confirm } : { password },
        );
        cache.clear();
        window.location.assign('/login');
      }
    } catch (e) {
      setError(catalogError(e));
    } finally {
      setPending(false);
      setPassword('');
      setNext('');
      setConfirm('');
    }
  }
  return (
    <section className="rounded-card border-hover bg-panel space-y-5 border p-5">
      <h2 className="font-semibold">Cuenta</h2>
      <p>Último acceso: {user.ultimoLogin ? dateLabel(user.ultimoLogin) : 'No registrado'}</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Input
        label="Contraseña actual"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <form className="space-y-3" onSubmit={(e) => void submit('profile', e)}>
        <Input
          label="Nombre"
          minLength={2}
          maxLength={150}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Usuario"
          minLength={3}
          maxLength={50}
          pattern="[a-zA-Z0-9_.-]+"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Button
          loading={pending}
          disabled={!password || (name === user.nombre && username === user.username)}
          type="submit"
        >
          Guardar perfil
        </Button>
      </form>
      <form
        className="border-hover space-y-3 border-t pt-4"
        onSubmit={(e) => void submit('password', e)}
      >
        <Input
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="Mínimo 12 caracteres, máximo 72 bytes UTF-8."
        />
        <Input
          label="Confirmar nueva contraseña"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button loading={pending} disabled={!password} type="submit">
          Cambiar contraseña y cerrar sesiones
        </Button>
      </form>
      <Button
        variant="danger"
        loading={pending}
        disabled={!password}
        onClick={() => void submit('logout')}
      >
        Cerrar todas las sesiones
      </Button>
    </section>
  );
}
function System() {
  const query = useQuery({
    queryKey: ['configuracion', 'sistema'],
    queryFn: () => api.get('/configuracion/sistema').then((r) => r.data.data),
  });
  const data = query.data;
  return (
    <section className="rounded-card border-hover space-y-3 border p-5">
      <h2 className="font-semibold">Diagnóstico</h2>
      {query.isPending ? (
        <p>Cargando diagnóstico…</p>
      ) : query.isError ? (
        <p role="alert">
          No se pudo cargar el diagnóstico.{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      ) : (
        <>
          <p>
            Base de datos: {data.database} · Aplicación: {data.version}
          </p>
          <p>
            Espacio libre para copias:{' '}
            {data.espacioLibre
              ? `${(Number(data.espacioLibre) / 1024 ** 3).toFixed(1)} GB`
              : 'No disponible'}
          </p>
          <p>
            Última importación:{' '}
            {data.ultimaImportacion
              ? `${data.ultimaImportacion.createdAt} · ${data.ultimaImportacion.estado}`
              : 'Sin importaciones'}
          </p>
          <p>
            Última exportación:{' '}
            {data.ultimaExportacion
              ? `${data.ultimaExportacion.createdAt} · ${data.ultimaExportacion.tipo}`
              : 'Sin exportaciones'}
          </p>
          <p>
            Última copia:{' '}
            {data.ultimaCopia
              ? `${data.ultimaCopia.createdAt} · ${data.ultimaCopia.state}`
              : 'Sin copias'}
          </p>
          <p>
            Última operación de copia:{' '}
            {data.ultimaOperacionCopia
              ? `${data.ultimaOperacionCopia.action} · ${data.ultimaOperacionCopia.state} · ${data.ultimaOperacionCopia.phase}`
              : 'Sin operaciones'}
          </p>
          <details>
            <summary>Migraciones aplicadas</summary>
            <ul className="break-all">
              {data.migraciones.map((m: string) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
          <Link href="/configuracion?tab=copias" className="text-primary underline">
            Consultar copias y sus resultados
          </Link>
        </>
      )}
    </section>
  );
}
function History() {
  const [page, setPage] = useState(1);
  const dateLabel = useDateLabel();
  const query = useQuery({
    queryKey: ['configuracion', 'historial', page],
    queryFn: () =>
      api.get('/configuracion/historial', { params: { page, limit: 10 } }).then((r) => r.data),
  });
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Historial de configuración y seguridad</h2>
      {query.isPending ? (
        <p>Cargando historial…</p>
      ) : query.isError ? (
        <p role="alert">
          No se pudo cargar el historial.{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {query.data.data.map(
              (row: {
                id: string;
                createdAt: string;
                tabla: string;
                accion: string;
                usuario?: { nombre: string };
                datosNuevos?: { motivo?: string };
              }) => (
                <li className="border-hover rounded border p-3" key={row.id}>
                  {dateLabel(row.createdAt)} · {row.usuario?.nombre ?? 'Sistema'} · {row.tabla} ·{' '}
                  {row.accion}
                  {row.datosNuevos?.motivo && <p>{row.datosNuevos.motivo}</p>}
                </li>
              ),
            )}
          </ul>
          {!query.data.data.length && <p>Sin cambios registrados.</p>}
          <div className="flex items-center gap-3">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              disabled={page >= query.data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

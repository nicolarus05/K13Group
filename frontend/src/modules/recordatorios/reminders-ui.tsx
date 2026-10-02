'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { clientesService } from '@/modules/clientes/services/clientes.service';
import {
  reminders,
  madridToday,
  dateLabel,
  kindLabel,
  type Reminder,
} from './recordatorios.service';
import { usePageBounds } from './use-page-bounds';
import '@/app/(dashboard)/dashboard/dashboard.css';
import './recordatorios.css';

export function Failure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rem-error">
      {isAxiosError(error)
        ? String(
            error.response?.data?.message ?? 'No se pudo guardar. Reintenta o recarga los datos.',
          )
        : 'No se pudieron cargar los datos. Reintenta.'}
    </p>
  );
}
export function Pager({
  page,
  totalPages,
  setPage,
}: {
  page: number;
  totalPages: number;
  setPage: (page: number) => void;
}) {
  return (
    <nav className="rem-pager" aria-label="Paginación">
      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Anterior
      </button>
      <span>
        Página {page} de {Math.max(1, totalPages)}
      </span>
      <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
        Siguiente
      </button>
    </nav>
  );
}
export function ReminderCreate({ done }: { done: () => void }) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [client, setClient] = useState<{ id: string; nombre: string } | null>(null);
  const request = useRef<string | null>(null);
  const clients = useQuery({
    queryKey: ['clientes', 'reminder-selector', search, page],
    queryFn: () => clientesService.findAll({ search, page, limit: 10 }).then((r) => r.data),
  });
  const mutation = useMutation({ mutationFn: reminders.create, onSuccess: done });
  usePageBounds(page, setPage, clients.data?.pagination, !clients.isFetching && !clients.isError);
  return (
    <section className="k13-panel rem-section">
      <h2>Nuevo recordatorio</h2>
      <p>Siempre vinculado a un cliente. No envía mensajes ni registra pagos.</p>
      <label>
        Buscar cliente
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {clients.isPending && <p role="status">Buscando clientes…</p>}
      {clients.isError && <Failure error={clients.error} />}
      <div className="rem-client-options">
        {clients.data?.data.map((c) => (
          <button
            key={c.id}
            disabled={mutation.isPending}
            aria-pressed={client?.id === c.id}
            onClick={() => {
              setClient(c);
              request.current = null;
            }}
          >
            {c.nombre}
          </button>
        ))}
      </div>
      {clients.data && (
        <Pager page={page} totalPages={clients.data.pagination.totalPages} setPage={setPage} />
      )}
      <p>
        Cliente seleccionado: <strong>{client?.nombre ?? 'Ninguno'}</strong>
      </p>
      <form
        onChange={() => {
          request.current = null;
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!client) return;
          const data = new FormData(e.currentTarget);
          request.current ??= crypto.randomUUID();
          mutation.mutate({
            clienteId: client.id,
            solicitudId: request.current,
            tipo: data.get('tipo'),
            fecha: data.get('fecha'),
            descripcion: data.get('descripcion'),
          });
        }}
      >
        <fieldset disabled={mutation.isPending}>
          <label>
            Tipo
            <select name="tipo">
              <option value="RENOVACION">Renovación</option>
              <option value="COBRO">Cobro</option>
              <option value="TELEGRAM">Contacto interno (sin envío)</option>
            </select>
          </label>
          <label>
            Fecha
            <input type="date" name="fecha" required defaultValue={madridToday()} />
          </label>
          <label>
            Descripción
            <textarea name="descripcion" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={!client}>
            Crear recordatorio
          </button>
          <button type="button" onClick={done}>
            Cerrar formulario
          </button>
        </fieldset>
      </form>
      {mutation.isError && <Failure error={mutation.error} />}
    </section>
  );
}
export function ReminderList() {
  const [vista, setVista] = useState('atencion'),
    [tipo, setTipo] = useState(''),
    [estado, setEstado] = useState(''),
    [search, setSearch] = useState('');
  const [desde, setDesde] = useState(''),
    [hasta, setHasta] = useState(''),
    [page, setPage] = useState(1),
    [create, setCreate] = useState(false);
  const filters = {
    vista,
    tipo: tipo || undefined,
    estado: estado || undefined,
    search,
    desde: desde || undefined,
    hasta: hasta || undefined,
    page,
  };
  const query = useQuery({
    queryKey: ['recordatorios', 'list', filters],
    queryFn: () => reminders.list(filters),
    staleTime: 0,
    refetchInterval: 60000,
  });
  const adjusting = usePageBounds(
    page,
    setPage,
    query.data?.pagination,
    !query.isFetching && !query.isError,
  );
  return (
    <div className="reminders">
      <header className="rem-heading">
        <div>
          <h1>Recordatorios</h1>
          <p>Seguimiento de clientes · solo avisos internos</p>
        </div>
        <Link href="/calendario">Ver calendario</Link>
        <button onClick={() => setCreate((v) => !v)}>Nuevo recordatorio</button>
      </header>
      {create && <ReminderCreate done={() => setCreate(false)} />}
      <section className="k13-panel rem-section">
        <div className="rem-filters" onChange={() => setPage(1)}>
          <label>
            Buscar cliente o descripción
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            Vista
            <select value={vista} onChange={(e) => setVista(e.target.value)}>
              <option value="atencion">Requieren atención</option>
              <option value="hoy">Hoy</option>
              <option value="atrasados">Atrasados</option>
              <option value="proximos">Próximos</option>
              <option value="todos">Todos e historial</option>
            </select>
          </label>
          <label>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="RENOVACION">Renovación</option>
              <option value="COBRO">Cobro</option>
              <option value="TELEGRAM">Contacto interno</option>
            </select>
          </label>
          <label>
            Estado
            <select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                if (['COMPLETADO', 'CANCELADO'].includes(e.target.value)) setVista('todos');
              }}
            >
              <option value="">Todos</option>
              {['PENDIENTE', 'POSPUESTO', 'COMPLETADO', 'CANCELADO'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
        </div>
        {(query.isPending || adjusting) && <p role="status">Cargando recordatorios…</p>}
        {query.isError && (
          <>
            <Failure error={query.error} />
            <button onClick={() => void query.refetch()}>Reintentar</button>
          </>
        )}
        {!query.isError && !adjusting && query.data && (
          <>
            <div className="k13-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha de seguimiento</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Descripción</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {dateLabel(r.fecha)}
                        {r.fechaOriginal && r.fechaOriginal !== r.fecha && (
                          <small>Original: {dateLabel(r.fechaOriginal)}</small>
                        )}
                      </td>
                      <td>
                        <Link href={'/clientes/' + r.cliente.id}>{r.cliente.nombre}</Link>
                      </td>
                      <td>
                        {kindLabel(r.tipo.valor)}
                        <small>{r.origen}</small>
                      </td>
                      <td>{r.estado.etiqueta}</td>
                      <td>{r.descripcion}</td>
                      <td>
                        <Link href={'/recordatorios/' + r.id}>Gestionar</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.data.length && <p>No hay recordatorios con estos filtros.</p>}
            <p>{query.data.pagination.total} recordatorios</p>
            <Pager page={page} totalPages={query.data.pagination.totalPages} setPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
type ReminderDraft = {
  base: Reminder;
  action: string;
  fecha: string;
  descripcion: string;
  motivo: string;
};
function ReminderActionForm({
  row,
  reload,
}: {
  row: Reminder;
  reload: () => Promise<Reminder | undefined>;
}) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [reloading, setReloading] = useState(false);
  const fresh = (): ReminderDraft => ({
    base: row,
    action: 'posponer',
    fecha: '',
    descripcion: row.descripcion ?? '',
    motivo: '',
  });
  const form = draft ?? fresh();
  const closed = ['COMPLETADO', 'CANCELADO'].includes(row.estado.valor);
  const changed = draft !== null && draft.base.version !== row.version;
  const change = (patch: Partial<Omit<ReminderDraft, 'base'>>) => {
    setNotice('');
    setDraft((previous) => ({ ...(previous ?? fresh()), ...patch }));
  };
  const mutation = useMutation({
    mutationFn: ({ action, data }: { action: string; data: Record<string, unknown> }) =>
      reminders.action(row.id, action, data),
    onSuccess: async (updated) => {
      // No permitir que una lectura anterior al guardado vuelva a mostrar la versión vieja.
      await cache.cancelQueries({ queryKey: ['recordatorios', row.id], exact: true });
      cache.setQueryData<Reminder>(['recordatorios', row.id], (current) =>
        current && current.version > updated.version ? current : updated,
      );
      setDraft(null);
      setNotice('Recordatorio actualizado. No se han cambiado suscripciones ni pagos.');
      await cache.invalidateQueries({ queryKey: ['recordatorios'] });
    },
  });
  async function discard() {
    setReloading(true);
    try {
      if (await reload()) {
        setDraft(null);
        setNotice('Borrador descartado. Se ha cargado la versión actual.');
        mutation.reset();
      }
    } finally {
      setReloading(false);
    }
  }
  return (
    <>
      {changed && (
        <p role="alert">
          El recordatorio ha cambiado en otra sesión. Tu borrador se conserva con su versión
          original; revísalo antes de continuar.
          {closed && ' El aviso ya está cerrado y no admite cambios.'}
        </p>
      )}
      {(!closed || draft) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (closed || mutation.isPending || reloading) return;
            setNotice('');
            setDraft(form);
            mutation.mutate({
              action: form.action,
              data: {
                version: form.base.version,
                motivo: form.motivo,
                ...(form.action === 'posponer' ? { fecha: form.fecha } : {}),
                ...(form.action === 'editar' ? { descripcion: form.descripcion } : {}),
              },
            });
          }}
        >
          <p>
            Cerrar un aviso no renueva el servicio ni confirma el cobro. Posponer solo cambia el
            seguimiento.
          </p>
          <fieldset disabled={mutation.isPending || reloading}>
            <label>
              Acción
              <select
                value={form.action}
                onChange={(e) => {
                  change({ action: e.target.value });
                  mutation.reset();
                }}
              >
                <option value="posponer">Posponer</option>
                <option value="completar">Completar aviso</option>
                <option value="cancelar">Cancelar aviso</option>
                {form.base.origen === 'MANUAL' && (
                  <option value="editar">Editar descripción</option>
                )}
              </select>
            </label>
            {form.action === 'posponer' && (
              <label>
                Nueva fecha
                <input
                  name="fecha"
                  type="date"
                  required
                  min={madridToday()}
                  value={form.fecha}
                  onChange={(e) => change({ fecha: e.target.value })}
                />
              </label>
            )}
            {form.action === 'editar' && (
              <label>
                Descripción
                <textarea
                  name="descripcion"
                  required
                  minLength={3}
                  maxLength={1000}
                  value={form.descripcion}
                  onChange={(e) => change({ descripcion: e.target.value })}
                />
              </label>
            )}
            <label>
              Motivo
              <textarea
                name="motivo"
                required
                minLength={3}
                maxLength={1000}
                value={form.motivo}
                onChange={(e) => change({ motivo: e.target.value })}
              />
            </label>
            <button type="submit" disabled={closed}>
              Guardar cambio
            </button>
          </fieldset>
        </form>
      )}
      {draft && (
        <button
          type="button"
          disabled={mutation.isPending || reloading}
          onClick={() => void discard()}
        >
          Descartar borrador y cargar versión actual
        </button>
      )}
      {mutation.isError && (
        <>
          <Failure error={mutation.error} />
          <button disabled={reloading} onClick={() => void reload()}>
            Recargar datos
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
export function ReminderDetail({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['recordatorios', id],
    queryFn: () => reminders.detail(id),
    staleTime: 0,
    refetchInterval: 60000,
  });
  const history = useQuery({
    queryKey: ['recordatorios', id, 'history', page],
    queryFn: () => reminders.history(id, page),
  });
  usePageBounds(page, setPage, history.data?.pagination, !history.isFetching && !history.isError);
  const r = query.data;
  return (
    <div className="reminders">
      <Link href="/recordatorios">← Recordatorios</Link>
      <h1>Detalle del recordatorio</h1>
      {query.isPending && <p>Cargando…</p>}
      {query.isError && (
        <>
          <Failure error={query.error} />
          <button onClick={() => void query.refetch()}>Recargar</button>
        </>
      )}
      {r && (
        <>
          <section className="k13-panel rem-section">
            <h2>
              {r.cliente.nombre} · {kindLabel(r.tipo.valor)}
            </h2>
            <p>{r.descripcion}</p>
            <p>
              Estado: {r.estado.etiqueta} · Origen: {r.origen}
            </p>
            <p>
              Seguimiento: {dateLabel(r.fecha)} · Fecha original:{' '}
              {dateLabel(r.fechaOriginal ?? r.fecha)}
            </p>
            <p>{r.motivo}</p>
            <div className="rem-links">
              <Link href={'/clientes/' + r.cliente.id}>Ver cliente</Link>
              {r.suscripcionId && (
                <Link href={'/suscripciones/' + r.suscripcionId}>Ver suscripción / renovar</Link>
              )}
              {r.movimiento?.renovacionId && (
                <Link href={'/renovaciones/' + r.movimiento.renovacionId}>
                  Ver renovación / registrar cobro
                </Link>
              )}
            </div>
            <ReminderActionForm
              key={r.id}
              row={r}
              reload={async () => {
                const result = await query.refetch();
                return result.isError ? undefined : result.data;
              }}
            />
          </section>
          <section className="k13-panel rem-section">
            <h2>Historial</h2>
            {history.isError && <Failure error={history.error} />}
            {history.data?.data.map((h) => (
              <article key={h.id}>
                <p>
                  <strong>{h.accion}</strong> ·{' '}
                  {new Date(h.createdAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} ·{' '}
                  {h.usuario?.nombre ?? 'Sistema'}
                </p>
                <p>
                  {h.datosNuevos?.motivo ?? h.datosNuevos?.descripcion}
                  {h.datosNuevos?.fecha && ' · ' + dateLabel(h.datosNuevos.fecha)}
                </p>
              </article>
            ))}
            {history.data && (
              <Pager
                page={page}
                totalPages={history.data.pagination.totalPages}
                setPage={setPage}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

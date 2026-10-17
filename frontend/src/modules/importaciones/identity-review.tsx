'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

type Data = {
  nombre: string;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
};
type Client = Data & { id: string; huella: string; eliminado: boolean; motivo?: string };
type Row = {
  id: string;
  hoja: string;
  fila: number;
  datos: Data;
  originales: Record<string, { valor: unknown; celda: string | null }>;
};
type Candidate = {
  datos: Data;
  id: string;
  nombre: string;
  telefono: string | null;
  motivo: string;
  filas: Array<{ id: string; hoja: string; fila: number }>;
};
type Group = {
  id: string;
  estado: string;
  decision: string;
  datos: Data;
  filas: Row[];
  problemas: string[];
  candidatos: Candidate[];
  totalCandidatos: number;
  clientes: Client[];
  totalClientes: number;
  clienteDestino: Client | null;
  historial: Array<{
    id: string;
    autor: string;
    fecha: string;
    accion: string;
    motivo: string;
    datos?: Data;
    campos?: string[];
    filas: string[];
  }>;
};
type Result = {
  preparado: boolean;
  version: number;
  resumen: Record<string, number>;
  filas: number;
  data: Group[];
  pagination: { page: number; total: number; totalPages: number };
};
const labels: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  CONFLICTO: 'Conflicto',
  REVISAR: 'Revisar decisión',
  NUEVO: 'Cliente nuevo propuesto',
  VINCULADO: 'Vinculado',
  EXCLUIDO: 'Excluido',
};
const empty: Data = { nombre: '', telefono: null, email: null, observaciones: null };
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const selectClass = 'rounded-input border border-hover bg-background p-2 max-w-full';

export function IdentityReview({ importId }: { importId: string }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [search, setSearch] = useState(''),
    [focus, setFocus] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({}),
    [version, setVersion] = useState<number | null>(null);
  const [action, setAction] = useState('NUEVO'),
    [data, setData] = useState<Data>(empty),
    [reason, setReason] = useState(''),
    [target, setTarget] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState(''),
    [clientPage, setClientPage] = useState(1),
    [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const review = useQuery({
    queryKey: ['importacion', importId, 'identidades', page, status, search, focus],
    enabled: open,
    queryFn: () =>
      api
        .get<Result>(`/importaciones/${importId}/identidades`, {
          params: {
            page,
            estado: status || undefined,
            buscar: search || undefined,
            identidadId: focus || undefined,
          },
        })
        .then((r) => r.data),
  });
  const clients = useQuery({
    queryKey: ['importacion', importId, 'identidades-clientes', clientSearch, clientPage],
    enabled: open && action === 'VINCULAR',
    queryFn: () =>
      api
        .get<{ data: Client[]; pagination: { totalPages: number } }>(
          `/importaciones/${importId}/identidades/clientes`,
          { params: { buscar: clientSearch || undefined, page: clientPage, limit: 10 } },
        )
        .then((r) => r.data),
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ['importacion', importId] });
  const clear = () => {
    setSelected({});
    setVersion(null);
    setTarget(null);
    setReason('');
    setData(empty);
    setError('');
    setRequestId('');
  };
  const choose = (
    rows: Array<{ id: string; hoja: string; fila: number }>,
    canonical: Data,
    include: boolean,
  ) => {
    if (busy) return;
    const next = { ...selected };
    for (const r of rows) {
      if (include) next[r.id] = `${r.hoja} · fila ${r.fila}`;
      else delete next[r.id];
    }
    if (!Object.keys(next).length) {
      clear();
      setNotice('');
      return;
    }
    setRequestId(crypto.randomUUID());
    if (!Object.keys(selected).length && include) {
      setVersion(review.data!.version);
      setData({ ...canonical });
    }
    setSelected(next);
    setNotice('');
  };
  const openGroup = (id: string) => {
    setFocus(id);
    setPage(1);
    setStatus('');
    setSearch('');
  };
  const selectClient = (client: Client) => {
    setTarget(client);
    setAction('VINCULAR');
    setRequestId(crypto.randomUUID());
  };
  const dirtyRequest = () => setRequestId(crypto.randomUUID());
  return (
    <details
      className="rounded-card border-hover border p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        12.2 · Revisar identidades y duplicados
      </summary>
      {open && (
        <section aria-label="Revisión de identidades" className="mt-4 space-y-4">
          <p>
            Decide qué filas pertenecen a cada persona. Las propuestas se guardan sin crear clientes
            ni operaciones. Coincidir por nombre no confirma una identidad.
          </p>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {review.isPending ? (
            <p>Cargando identidades…</p>
          ) : review.isError ? (
            <div role="alert">
              No se pudo cargar la revisión.{' '}
              <Button onClick={() => void review.refetch()}>Reintentar identidades</Button>
            </div>
          ) : !review.data.preparado ? (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api.post(`/importaciones/${importId}/identidades/preparar`);
                  await refresh();
                } catch (e) {
                  setError(catalogError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Preparar revisión de identidades
            </Button>
          ) : (
            <>
              <p>
                {review.data.filas} filas de origen ·{' '}
                {Object.entries(review.data.resumen)
                  .map(([k, v]) => `${labels[k] ?? k}: ${v}`)
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  Situación de identidad{' '}
                  <select
                    className={selectClass}
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                      setFocus('');
                    }}
                  >
                    <option value="">Todas</option>
                    {Object.entries(labels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Buscar identidad por nombre, teléfono o fila"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                    setFocus('');
                  }}
                />
                {focus && (
                  <Button
                    onClick={() => {
                      setFocus('');
                      setPage(1);
                    }}
                  >
                    Ver todas las identidades
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {!review.data.data.length && <p>No hay identidades con estos filtros.</p>}
                {review.data.data.map((group) => (
                  <article key={group.id} className="border-hover space-y-3 rounded border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <strong>{group.datos.nombre || 'Sin nombre'}</strong>
                      <span>{labels[group.estado]}</span>
                      <span>{text(group.datos.telefono)}</span>
                      <Button
                        disabled={busy}
                        onClick={() => choose(group.filas, group.datos, true)}
                      >
                        Seleccionar {group.filas.length} filas de esta identidad
                      </Button>
                    </div>
                    {group.problemas.map((p) => (
                      <p key={p} role="alert">
                        {p}
                      </p>
                    ))}
                    {group.clienteDestino && (
                      <p>
                        Destino: {group.clienteDestino.nombre} ·{' '}
                        {text(group.clienteDestino.telefono)}
                        {group.clienteDestino.eliminado ? ' · eliminado' : ''}
                      </p>
                    )}
                    <details>
                      <summary>Comparar filas de origen ({group.filas.length})</summary>
                      <div className="max-h-96 overflow-auto">
                        {group.filas.map((row) => (
                          <div key={row.id} className="border-hover space-y-1 border-t py-2">
                            <label className="flex gap-2">
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={!!selected[row.id]}
                                onChange={(e) => choose([row], group.datos, e.target.checked)}
                              />
                              {row.hoja} · fila {row.fila}
                            </label>
                            <p className="break-words">
                              {row.datos.nombre || 'Sin nombre'} · Teléfono:{' '}
                              {text(row.datos.telefono)} · Email: {text(row.datos.email)}
                            </p>
                            <p className="break-words">
                              Observaciones: {text(row.datos.observaciones)}
                            </p>
                            <details>
                              <summary>
                                Valores originales de {row.hoja} · fila {row.fila}
                              </summary>
                              {Object.entries(row.originales).map(([k, v]) => (
                                <p className="break-words" key={k}>
                                  {k} ({v.celda ?? 'sin columna'}): {text(v.valor)}
                                </p>
                              ))}
                            </details>
                          </div>
                        ))}
                      </div>
                    </details>
                    {(group.candidatos.length > 0 || group.clientes.length > 0) && (
                      <details>
                        <summary>
                          Posibles coincidencias ({group.totalCandidatos} identidades,{' '}
                          {group.totalClientes} clientes)
                        </summary>
                        <p>
                          Se muestran hasta 20 de cada tipo. Usa la búsqueda para revisar otras
                          coincidencias.
                        </p>
                        {group.candidatos.map((c) => (
                          <div
                            key={c.id}
                            className="border-hover flex flex-wrap items-center gap-2 border-t py-2"
                          >
                            <span>
                              {c.nombre || 'Sin nombre'} · {text(c.telefono)} · {c.motivo}
                            </span>
                            <Button onClick={() => openGroup(c.id)}>Comparar identidad</Button>
                            <Button disabled={busy} onClick={() => choose(c.filas, c.datos, true)}>
                              Añadir sus {c.filas.length} filas a la selección
                            </Button>
                          </div>
                        ))}
                        {group.clientes.map((c) => (
                          <div
                            key={c.id}
                            className="border-hover flex flex-wrap items-center gap-2 border-t py-2"
                          >
                            <span>
                              Cliente: {c.nombre} · {text(c.telefono)} · {c.motivo}
                            </span>
                            <Button disabled={busy} onClick={() => selectClient(c)}>
                              Elegir cliente {c.nombre}
                            </Button>
                          </div>
                        ))}
                      </details>
                    )}
                    {!!group.historial.length && (
                      <details>
                        <summary>Historial de identidad ({group.historial.length})</summary>
                        {group.historial.map((event) => (
                          <div className="border-hover border-t py-2 break-words" key={event.id}>
                            <p>
                              {event.accion} · {event.autor} · {event.fecha}
                            </p>
                            <p>
                              {event.motivo} · {event.filas.length} filas
                            </p>
                            {event.datos && (
                              <p>
                                {event.datos.nombre} · {text(event.datos.telefono)} ·{' '}
                                {text(event.datos.email)}
                              </p>
                            )}
                            {event.campos && <p>Campos corregidos: {event.campos.join(', ')}</p>}
                          </div>
                        ))}
                      </details>
                    )}
                  </article>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Identidades anteriores
                </Button>
                <span>
                  Página {page} · {review.data.pagination.total} identidades
                </span>
                <Button
                  disabled={page >= review.data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Más identidades
                </Button>
              </div>
              <form
                aria-label="Decidir identidad"
                className="border-hover space-y-3 rounded border p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  setNotice('');
                  try {
                    await api.patch(`/importaciones/${importId}/identidades/decidir`, {
                      version,
                      solicitudId: requestId,
                      filas: Object.keys(selected),
                      accion: action,
                      motivo: reason,
                      ...(action === 'NUEVO' ? { datos: data } : {}),
                      ...(action === 'VINCULAR'
                        ? { clienteDestinoId: target?.id, huellaCliente: target?.huella }
                        : {}),
                    });
                    clear();
                    setFocus('');
                    setPage(1);
                    await refresh();
                    setNotice(
                      'Decisión guardada. Las filas originales y sus operaciones se conservan.',
                    );
                  } catch (e) {
                    setError(catalogError(e));
                    void refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3 className="font-semibold">Decidir sobre las filas seleccionadas</h3>
                <p>
                  {Object.keys(selected).length} filas seleccionadas. Puedes seleccionar filas de
                  distintas páginas para agruparlas, o una parte de una identidad para separarla.
                </p>
                {!!Object.keys(selected).length && (
                  <details>
                    <summary>Revisar selección</summary>
                    <div className="max-h-60 overflow-auto">
                      {Object.entries(selected).map(([id, label]) => (
                        <p key={id}>
                          {label}{' '}
                          <button
                            type="button"
                            disabled={busy}
                            className="underline"
                            onClick={() => {
                              if (Object.keys(selected).length === 1) {
                                clear();
                                return;
                              }
                              setSelected((s) => {
                                const n = { ...s };
                                delete n[id];
                                return n;
                              });
                              dirtyRequest();
                            }}
                          >
                            Quitar
                          </button>
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                {version !== null && version !== review.data.version && (
                  <p role="alert">
                    La revisión ha cambiado. Tu borrador se conserva; descarta la selección y revisa
                    los datos actuales antes de guardar.
                  </p>
                )}
                <Button type="button" disabled={busy} onClick={clear}>
                  Descartar selección y borrador
                </Button>
                <fieldset disabled={busy} className="space-y-3">
                  <label>
                    Decisión de identidad{' '}
                    <select
                      aria-label="Decisión de identidad"
                      className={selectClass}
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        dirtyRequest();
                      }}
                    >
                      <option value="NUEVO">Proponer cliente nuevo</option>
                      <option value="VINCULAR">Vincular a cliente existente</option>
                      <option value="PENDIENTE">Dejar pendiente</option>
                      <option value="EXCLUIR">Excluir de la futura importación</option>
                    </select>
                  </label>
                  {action === 'NUEVO' && (
                    <>
                      <p>
                        Elige los datos del cliente propuesto. Los campos opcionales vacíos se
                        guardan como ausentes. Un teléfono compartido requiere resolver el
                        conflicto.
                      </p>
                      {(['nombre', 'telefono', 'email', 'observaciones'] as const).map((key) => (
                        <Input
                          key={key}
                          label={`Identidad: ${key}`}
                          value={data[key] ?? ''}
                          required={key === 'nombre'}
                          maxLength={
                            key === 'observaciones' ? 10000 : key === 'telefono' ? 30 : 150
                          }
                          onChange={(e) => {
                            setData((d) => ({
                              ...d,
                              [key]: key === 'nombre' ? e.target.value : e.target.value || null,
                            }));
                            dirtyRequest();
                          }}
                        />
                      ))}
                    </>
                  )}
                  {action === 'VINCULAR' && (
                    <div className="space-y-2">
                      <Input
                        label="Buscar cliente de destino"
                        value={clientSearch}
                        onChange={(e) => {
                          setClientSearch(e.target.value);
                          setClientPage(1);
                        }}
                      />
                      {target && (
                        <p>
                          Cliente seleccionado: {target.nombre} · {text(target.telefono)} ·{' '}
                          {text(target.email)}. Se conservarán sus datos actuales.
                        </p>
                      )}
                      {clients.isPending ? (
                        <p>Buscando clientes…</p>
                      ) : clients.isError ? (
                        <p role="alert">
                          No se pueden cargar los clientes.{' '}
                          <Button type="button" onClick={() => void clients.refetch()}>
                            Reintentar clientes
                          </Button>
                        </p>
                      ) : (
                        <>
                          {!clients.data.data.length && <p>No hay clientes con esta búsqueda.</p>}
                          {clients.data.data.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center gap-2">
                              <span>
                                {c.nombre} · {text(c.telefono)} · {text(c.email)}
                              </span>
                              <Button type="button" onClick={() => selectClient(c)}>
                                Elegir cliente {c.nombre}
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            disabled={clientPage === 1}
                            onClick={() => setClientPage(clientPage - 1)}
                          >
                            Clientes anteriores
                          </Button>
                          <Button
                            type="button"
                            disabled={clientPage >= clients.data.pagination.totalPages}
                            onClick={() => setClientPage(clientPage + 1)}
                          >
                            Más clientes
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  <Input
                    label="Motivo de la decisión de identidad"
                    value={reason}
                    required
                    minLength={3}
                    maxLength={1000}
                    onChange={(e) => {
                      setReason(e.target.value);
                      dirtyRequest();
                    }}
                  />
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={
                      !Object.keys(selected).length ||
                      version !== review.data.version ||
                      (action === 'VINCULAR' && !target)
                    }
                  >
                    Guardar decisión de identidad
                  </Button>
                </fieldset>
              </form>
            </>
          )}
        </section>
      )}
    </details>
  );
}

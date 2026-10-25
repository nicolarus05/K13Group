'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

type Row = {
  id: string;
  tabla: string;
  registroId: string | null;
  accion: string;
  createdAt: string;
  usuario: { id: string; nombre: string } | null;
};
type Detail = Row & {
  datosAnteriores: unknown;
  datosNuevos: unknown;
  cambios: { campo: string; anterior: unknown; nuevo: unknown }[] | null;
};
const empty = {
  tabla: '',
  accion: '',
  usuarioId: '',
  origen: '',
  registroId: '',
  desde: '',
  hasta: '',
};
const format = (v: unknown) =>
  v == null ? 'Sin información registrada' : JSON.stringify(v, null, 2);
const date = (v: string) => new Date(v).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

export default function Page() {
  const cache = useQueryClient();
  const [draft, setDraft] = useState(empty),
    [filters, setFilters] = useState(empty);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ['auditoria-filtros'],
    queryFn: () =>
      api
        .get<{
          data: {
            tablas: string[];
            acciones: string[];
            usuarios: { id: string; nombre: string }[];
          };
        }>('/auditoria/filtros')
        .then((r) => r.data.data),
  });
  const cursor = cursors.at(-1);
  const result = useQuery({
    queryKey: ['auditoria', filters, cursor],
    queryFn: () => {
      const params: Record<string, string | undefined> = { ...filters, cursor };
      for (const key of Object.keys(params)) if (!params[key]) delete params[key];
      for (const key of ['desde', 'hasta'])
        if (params[key]) params[key] = new Date(params[key]!).toISOString();
      return api
        .get<{ data: Row[]; pagination: { siguiente: string | null } }>('/auditoria', { params })
        .then((r) => r.data);
    },
  });
  const detail = useQuery({
    queryKey: ['auditoria-detalle', selected],
    enabled: !!selected,
    queryFn: () => api.get<{ data: Detail }>('/auditoria/' + selected).then((r) => r.data.data),
  });
  function apply(next = draft) {
    setFilters(next);
    setCursors([undefined]);
    setSelected(null);
  }
  const input = 'rounded border bg-white p-2 text-black';
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Auditoría</h1>
      <p>
        Actividad de usuarios y procesos automáticos. El historial incluye registros retirados.
        Fechas mostradas en Europe/Madrid.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="grid gap-1">
          Módulo
          <select
            className={input}
            aria-label="Módulo"
            value={draft.tabla}
            onChange={(e) => setDraft({ ...draft, tabla: e.target.value })}
          >
            <option value="">Todos</option>
            {options.data?.tablas.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Acción
          <select
            className={input}
            aria-label="Acción"
            value={draft.accion}
            onChange={(e) => setDraft({ ...draft, accion: e.target.value })}
          >
            <option value="">Todas</option>
            {options.data?.acciones.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Origen
          <select
            className={input}
            aria-label="Origen"
            value={draft.origen}
            onChange={(e) => setDraft({ ...draft, origen: e.target.value, usuarioId: '' })}
          >
            <option value="">Todos</option>
            <option value="usuario">Usuario</option>
            <option value="sistema">Sistema</option>
          </select>
        </label>
        <label className="grid gap-1">
          Usuario
          <select
            className={input}
            disabled={draft.origen === 'sistema'}
            aria-label="Usuario"
            value={draft.usuarioId}
            onChange={(e) => setDraft({ ...draft, usuarioId: e.target.value })}
          >
            <option value="">Todos</option>
            {options.data?.usuarios.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Desde (hora de tu equipo)
          <input
            className={input}
            type="datetime-local"
            value={draft.desde}
            onChange={(e) => setDraft({ ...draft, desde: e.target.value })}
          />
        </label>
        <label className="grid gap-1">
          Hasta (hora de tu equipo)
          <input
            className={input}
            type="datetime-local"
            value={draft.hasta}
            onChange={(e) => setDraft({ ...draft, hasta: e.target.value })}
          />
        </label>
        <label className="grid gap-1">
          Identificador del registro
          <input
            className={input}
            value={draft.registroId}
            onChange={(e) => setDraft({ ...draft, registroId: e.target.value })}
          />
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Filtrar</Button>
          <Button
            type="button"
            onClick={() => {
              setDraft(empty);
              apply(empty);
            }}
          >
            Limpiar
          </Button>
        </div>
      </form>
      {options.isError && (
        <p role="alert">
          No se pudieron cargar los filtros.{' '}
          <Button onClick={() => void options.refetch()}>Reintentar filtros</Button>
        </p>
      )}
      {result.isPending && <p role="status">Cargando actividad…</p>}
      {result.isError && (
        <p role="alert">
          {catalogError(result.error)}{' '}
          <Button onClick={() => void result.refetch()}>Reintentar</Button>
        </p>
      )}
      {result.data?.data.length === 0 && <p>No hay actividad con estos filtros.</p>}
      {result.data?.data.map((row) => (
        <article key={row.id} className="space-y-2 rounded border p-3">
          <p>
            <strong>
              {row.tabla} · {row.accion}
            </strong>{' '}
            · {row.usuario?.nombre ?? 'Sistema'}
          </p>
          <p>{date(row.createdAt)}</p>
          {row.registroId && <p className="break-all">Registro: {row.registroId}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSelected(row.id)}>Ver detalle</Button>
            {row.registroId && (
              <Button
                onClick={() => {
                  const next = { ...empty, tabla: row.tabla, registroId: row.registroId! };
                  setDraft(next);
                  apply(next);
                }}
              >
                Historial del registro
              </Button>
            )}
          </div>
          {selected === row.id && (
            <section aria-label="Detalle de actividad" className="space-y-3 border-t pt-3">
              {detail.isPending && <p role="status">Cargando detalle…</p>}
              {detail.isError && (
                <p role="alert">
                  {catalogError(detail.error)}{' '}
                  <Button onClick={() => void detail.refetch()}>Reintentar detalle</Button>
                </p>
              )}
              {detail.data && (
                <>
                  <p>Los campos sensibles se muestran como [Oculto].</p>
                  {detail.data.cambios === null ? (
                    <p>
                      No se registraron ambas instantáneas; no se puede reconstruir la comparación.
                    </p>
                  ) : detail.data.cambios.length === 0 ? (
                    <p>No hay cambios visibles entre las instantáneas.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr>
                            <th>Campo</th>
                            <th>Anterior</th>
                            <th>Nuevo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data.cambios.map((c) => (
                            <tr key={c.campo}>
                              <th>{c.campo}</th>
                              <td>
                                <pre className="p-2 break-all whitespace-pre-wrap">
                                  {format(c.anterior)}
                                </pre>
                              </td>
                              <td>
                                <pre className="p-2 break-all whitespace-pre-wrap">
                                  {format(c.nuevo)}
                                </pre>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <details>
                    <summary>Datos registrados y referencias relacionadas</summary>
                    <h3>Anterior</h3>
                    <pre className="break-all whitespace-pre-wrap">
                      {format(detail.data.datosAnteriores)}
                    </pre>
                    <h3>Nuevo</h3>
                    <pre className="break-all whitespace-pre-wrap">
                      {format(detail.data.datosNuevos)}
                    </pre>
                  </details>
                </>
              )}
              <Button onClick={() => setSelected(null)}>Cerrar detalle</Button>
            </section>
          )}
        </article>
      ))}
      <div className="flex items-center gap-3">
        <Button
          disabled={cursors.length === 1 || result.isFetching}
          onClick={() => {
            setSelected(null);
            setCursors(cursors.slice(0, -1));
          }}
        >
          Anterior
        </Button>
        <span>Página {cursors.length}</span>
        <Button
          disabled={!result.data?.pagination.siguiente || result.isFetching}
          onClick={() => {
            setSelected(null);
            setCursors([...cursors, result.data!.pagination.siguiente!]);
          }}
        >
          Siguiente
        </Button>
        <Button
          onClick={() => {
            setSelected(null);
            setCursors([undefined]);
            void cache.invalidateQueries({ queryKey: ['auditoria'] });
            void cache.invalidateQueries({ queryKey: ['auditoria-filtros'] });
          }}
        >
          Actualizar
        </Button>
      </div>
    </div>
  );
}

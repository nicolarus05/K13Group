'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

const types = ['PRODUCTO', 'TARIFA', 'SERVIDOR', 'REFERENCIA', 'PAGO'] as const;
type Kind = (typeof types)[number];
type Catalog = {
  id: string;
  nombre: string;
  activo: boolean;
  productoId?: string;
  duracionMeses?: number;
  precio?: number;
};
type Cell = {
  clave: string;
  etiqueta: string;
  estado: string;
  original: unknown;
  efectivo: unknown;
  corregido: boolean;
  celda: string | null;
  ausente: boolean;
  ignorado: boolean;
  destino: Catalog | null;
  sugerencias: Catalog[];
  alcance: string | null;
  motivo: string | null;
};
type Row = {
  id: string;
  hoja: string;
  fila: number;
  excluida: boolean;
  identidad: string;
  suscripcion: string;
  finanzas: string;
  fechaFin: string | null;
  fechaInicioPropuesta: string | null;
  importeAnual: number | null;
  totalAcumulado: number | null;
  referenciaPropia: { clave: string; nombre: string } | null;
  advertencias: string[];
  campos: Record<Kind, Cell>;
};
type Result = {
  version: number;
  huellaRevision: string;
  hojas: string[];
  catalogos: Record<Kind, Catalog[]>;
  inventario: Array<{
    clave: string;
    etiqueta: string;
    total: number;
    elegibles: number;
    estados: Record<string, number>;
  }>;
  resumen: {
    filas: number;
    excluidas: number;
    identidadesResueltas: number;
    suscripcionesResueltas: number;
    historicas: number;
    pendientesPago: number;
  };
  data: Row[];
  pagination: { page: number; total: number; totalPages: number };
  historial: Array<{
    id: string;
    version: number;
    alcance: string;
    accion: string;
    autor: string;
    motivo: string;
    fecha: string;
    destino: { origen: string; destino: string | null };
  }>;
};
type Draft = {
  huellaRevision: string;
  solicitudId: string;
  tipo: Kind;
  alcance: string;
  clave: string;
  filaId?: string;
  accion: string;
  entidadId?: string;
  historico: boolean;
  motivo: string;
};
type Preview = {
  total: number;
  cambiosEfectivos: number;
  excepcionesConservadas: number;
  destino: Catalog | null;
  filas: Array<{
    id: string;
    hoja: string;
    fila: number;
    antes: { estado: string; destino: Catalog | null };
    despues: { estado: string; destino: Catalog | null };
  }>;
  aviso: string;
};
const selectClass = 'rounded-input border border-hover bg-background p-2 max-w-full';
const text = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

export function EquivalenceReview({ importId }: { importId: string }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<Kind>('PRODUCTO');
  const [sheet, setSheet] = useState(''),
    [status, setStatus] = useState(''),
    [key, setKey] = useState(''),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Row | null>(null),
    [scope, setScope] = useState('VALOR'),
    [action, setAction] = useState('ASIGNAR');
  const [selectionRevision, setSelectionRevision] = useState('');
  const [target, setTarget] = useState(''),
    [historical, setHistorical] = useState(false),
    [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ body: Draft; result: Preview } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const review = useQuery({
    queryKey: ['importacion', importId, 'equivalencias-revision', kind, sheet, status, key, page],
    enabled: open,
    queryFn: () =>
      api
        .get<Result>(`/importaciones/${importId}/equivalencias-revision`, {
          params: {
            tipo: kind,
            hoja: sheet || undefined,
            estado: status || undefined,
            clave: key || undefined,
            page,
            limit: 25,
          },
        })
        .then((r) => r.data),
  });
  const data = review.data;
  const clear = () => {
    setPreview(null);
    setError('');
    setNotice('');
  };
  const reset = () => {
    clear();
    setSelected(null);
    setTarget('');
    setHistorical(false);
    setReason('');
  };
  const choose = (row: Row) => {
    reset();
    setSelected(row);
    setSelectionRevision(data?.huellaRevision ?? '');
    setScope(row.campos[kind].ausente ? 'FILA' : 'VALOR');
    setAction('ASIGNAR');
  };
  const cell = selected?.campos[kind];
  const options = (data?.catalogos[kind] ?? []).filter(
    (c) =>
      kind !== 'TARIFA' ||
      (selected?.campos.PRODUCTO.estado === 'RESUELTA' &&
        c.productoId === selected.campos.PRODUCTO.destino?.id),
  );
  const selectedTarget = options.find((c) => c.id === target);
  const makePreview = async () => {
    if (!data || !selected || !cell || selectionRevision !== data.huellaRevision) return;
    setBusy(true);
    setError('');
    setPreview(null);
    const body: Draft = {
      huellaRevision: data.huellaRevision,
      solicitudId: crypto.randomUUID(),
      tipo: kind,
      alcance: scope,
      clave: cell.clave,
      ...(scope === 'FILA' ? { filaId: selected.id } : {}),
      accion: action,
      ...(action === 'ASIGNAR' ? { entidadId: target } : {}),
      historico: action === 'ASIGNAR' && historical,
      motivo: reason.trim(),
    };
    try {
      const result = (
        await api.post<Preview>(
          `/importaciones/${importId}/equivalencias-revision/previsualizar`,
          body,
        )
      ).data;
      setPreview({ body, result });
    } catch (e) {
      setError(catalogError(e));
      await review.refetch();
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/importaciones/${importId}/equivalencias-revision`, preview.body);
      reset();
      setNotice('Equivalencia guardada. No se han creado operaciones.');
      await cache.invalidateQueries({ queryKey: ['importacion', importId] });
    } catch (e) {
      setError(catalogError(e));
      await review.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="rounded-card border-hover border p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        12.3 · Revisar equivalencias y operaciones propuestas
      </summary>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-text-secondary text-sm">
            Revisa producto, tarifa anual, servidor, referencia de origen y método de pago. PE
            significa pendiente de pago; PA se ignora. FECHA es el vencimiento y TOTAL es acumulado,
            no un ingreso. Esta revisión no importa operaciones.
          </p>
          {review.isPending && <p>Cargando equivalencias…</p>}
          {review.error && <p role="alert">{catalogError(review.error)}</p>}
          {data && (
            <>
              <p>
                {data.resumen.filas} filas · {data.resumen.excluidas} excluidas ·{' '}
                {data.resumen.identidadesResueltas} con identidad resuelta ·{' '}
                {data.resumen.suscripcionesResueltas} con suscripción revisada ·{' '}
                {data.resumen.historicas} históricas · {data.resumen.pendientesPago} pendientes de
                pago.
              </p>
              <div className="flex flex-wrap gap-3">
                <label>
                  Campo{' '}
                  <select
                    aria-label="Campo de equivalencia"
                    className={selectClass}
                    value={kind}
                    disabled={busy}
                    onChange={(e) => {
                      reset();
                      setKind(e.target.value as Kind);
                      setKey('');
                      setStatus('');
                      setPage(1);
                    }}
                  >
                    {types.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Hoja{' '}
                  <select
                    aria-label="Hoja de equivalencia"
                    className={selectClass}
                    value={sheet}
                    disabled={busy}
                    onChange={(e) => {
                      reset();
                      setSheet(e.target.value);
                      setKey('');
                      setPage(1);
                    }}
                  >
                    <option value="">Todas</option>
                    {data.hojas.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Estado{' '}
                  <select
                    aria-label="Estado de equivalencia"
                    className={selectClass}
                    value={status}
                    disabled={busy}
                    onChange={(e) => {
                      reset();
                      setStatus(e.target.value);
                      setKey('');
                      setPage(1);
                    }}
                  >
                    <option value="">Todos</option>
                    {[
                      'PENDIENTE',
                      'REVISAR',
                      'RESUELTA',
                      'HISTORICA',
                      'SIN_DATO',
                      'IGNORADO',
                      'EXCLUIDO',
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Origen{' '}
                  <select
                    aria-label="Valor de origen"
                    className={selectClass}
                    value={key}
                    disabled={busy}
                    onChange={(e) => {
                      reset();
                      setKey(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Todos los valores</option>
                    {data.inventario.map((g) => (
                      <option key={g.clave} value={g.clave}>
                        {g.etiqueta} · {g.total} filas ·{' '}
                        {Object.entries(g.estados)
                          .map(([s, n]) => `${s}: ${n}`)
                          .join(', ')}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    reset();
                    void review.refetch();
                  }}
                >
                  Actualizar equivalencias
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        'Fila',
                        'Original / corrección',
                        'Destino',
                        'Estado',
                        'Preparación',
                        'Revisión',
                      ].map((h) => (
                        <th className="p-2" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => {
                      const c = row.campos[kind];
                      return (
                        <tr key={row.id} className="border-hover border-t">
                          <td className="p-2">
                            {row.hoja} · {row.fila}
                          </td>
                          <td className="p-2">
                            {text(c.original)}
                            {c.corregido && <div>Corregido: {text(c.efectivo)}</div>}
                            <div className="text-text-secondary">
                              {c.etiqueta} · {c.celda ?? 'columna ausente'}
                            </div>
                          </td>
                          <td className="p-2">
                            {c.destino?.nombre ?? 'Sin asignar'}
                            {c.alcance && <div>Alcance: {c.alcance}</div>}
                          </td>
                          <td className="p-2">{row.excluida ? 'EXCLUIDO' : c.estado}</td>
                          <td className="p-2">
                            Identidad: {row.identidad}
                            <br />
                            Suscripción: {row.suscripcion}
                            <br />
                            Finanzas: {row.finanzas}
                          </td>
                          <td className="p-2">
                            <Button
                              variant="secondary"
                              disabled={busy || row.excluida || c.ignorado}
                              onClick={() => choose(row)}
                            >
                              Revisar {row.hoja} {row.fila}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!data.data.length && <p>No hay filas para estos filtros.</p>}
              <div className="flex items-center gap-3">
                <Button
                  disabled={busy || page === 1}
                  onClick={() => {
                    reset();
                    setPage(page - 1);
                  }}
                >
                  Anterior
                </Button>
                <span>
                  Página {page} de {Math.max(1, data.pagination.totalPages)} ·{' '}
                  {data.pagination.total} filas
                </span>
                <Button
                  disabled={busy || page >= data.pagination.totalPages}
                  onClick={() => {
                    reset();
                    setPage(page + 1);
                  }}
                >
                  Siguiente
                </Button>
              </div>
              {selected && cell && (
                <fieldset
                  disabled={busy}
                  className="rounded-card border-hover space-y-3 border p-4"
                >
                  <legend>
                    Decisión de {kind} · {selected.hoja} {selected.fila}
                  </legend>
                  <p>
                    Origen: {cell.etiqueta}. Vencimiento: {text(selected.fechaFin)}. Inicio anual
                    propuesto: {text(selected.fechaInicioPropuesta)}. P.AÑO:{' '}
                    {text(selected.importeAnual)}. TOTAL acumulado: {text(selected.totalAcumulado)}.
                  </p>
                  <p>
                    Referencia propia propuesta para la identidad:{' '}
                    {selected.referenciaPropia?.nombre ?? 'Pendiente de confirmar identidad'}. Es
                    independiente de la referencia de origen.
                  </p>
                  {selected.advertencias.map((w) => (
                    <p key={w} className="text-amber-700">
                      {w}
                    </p>
                  ))}
                  {cell.sugerencias.length > 0 && (
                    <p>
                      Sugerencias por revisar: {cell.sugerencias.map((c) => c.nombre).join(', ')}.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <label>
                      Alcance{' '}
                      <select
                        aria-label="Alcance de equivalencia"
                        className={selectClass}
                        value={scope}
                        onChange={(e) => {
                          clear();
                          setScope(e.target.value);
                        }}
                      >
                        <option value="VALOR">Todas las filas con este valor</option>
                        <option value="FILA">Solo esta fila</option>
                      </select>
                    </label>
                    <label>
                      Decisión{' '}
                      <select
                        aria-label="Decisión de equivalencia"
                        className={selectClass}
                        value={action}
                        onChange={(e) => {
                          clear();
                          setAction(e.target.value);
                          setHistorical(false);
                        }}
                      >
                        <option value="ASIGNAR">Asignar destino</option>
                        <option value="PENDIENTE">Dejar pendiente</option>
                        <option value="HEREDAR">Retirar decisión / heredar valor</option>
                      </select>
                    </label>
                    {action === 'ASIGNAR' && (
                      <label>
                        Destino{' '}
                        <select
                          aria-label="Destino de equivalencia"
                          className={selectClass}
                          value={target}
                          onChange={(e) => {
                            clear();
                            setTarget(e.target.value);
                            setHistorical(false);
                          }}
                        >
                          <option value="">Selecciona un destino</option>
                          {options.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                              {!c.activo ? ' · inactivo, solo histórico' : ''}
                              {kind === 'TARIFA'
                                ? ` · ${c.duracionMeses} meses · ${c.precio} €`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {action === 'ASIGNAR' && !options.length && (
                    <p>
                      No hay destinos compatibles. Revisa el producto o crea el dato necesario desde
                      Catálogos y después actualiza esta revisión.
                    </p>
                  )}
                  {action === 'ASIGNAR' && selectedTarget && !selectedTarget.activo && (
                    <label className="block">
                      <input
                        type="checkbox"
                        checked={historical}
                        onChange={(e) => {
                          clear();
                          setHistorical(e.target.checked);
                        }}
                      />{' '}
                      Confirmo el uso exclusivamente histórico; no se reactiva el servidor.
                    </label>
                  )}
                  <label className="block">
                    Motivo de equivalencia
                    <Input
                      aria-label="Motivo de equivalencia"
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => {
                        clear();
                        setReason(e.target.value);
                      }}
                    />
                  </label>
                  {selectionRevision !== data.huellaRevision && (
                    <p>
                      Los datos han cambiado. Selecciona de nuevo la fila para revisar su estado
                      actual.
                    </p>
                  )}
                  <Button
                    disabled={
                      busy ||
                      selectionRevision !== data.huellaRevision ||
                      reason.trim().length < 3 ||
                      (action === 'ASIGNAR' && !target)
                    }
                    onClick={() => void makePreview()}
                  >
                    Previsualizar equivalencia
                  </Button>
                  {preview && (
                    <div className="space-y-2" role="status">
                      <p>
                        {preview.result.total} filas en el alcance ·{' '}
                        {preview.result.cambiosEfectivos} cambios efectivos ·{' '}
                        {preview.result.excepcionesConservadas} excepciones conservadas. Destino:{' '}
                        {preview.result.destino?.nombre ?? 'Sin destino'}.
                      </p>
                      <p>{preview.result.aviso}</p>
                      <details>
                        <summary>Ver filas afectadas</summary>
                        <ul className="max-h-40 overflow-y-auto">
                          {preview.result.filas.map((r) => (
                            <li key={r.id}>
                              {r.hoja} {r.fila}: {r.antes.destino?.nombre ?? 'Sin destino'} (
                              {r.antes.estado}){' → '}
                              {r.despues.destino?.nombre ?? 'Sin destino'} ({r.despues.estado})
                            </li>
                          ))}
                        </ul>
                      </details>
                      {preview.body.huellaRevision !== data.huellaRevision && (
                        <p>La revisión ha cambiado. Vuelve a previsualizar.</p>
                      )}
                      <Button
                        disabled={busy || preview.body.huellaRevision !== data.huellaRevision}
                        onClick={() => void save()}
                      >
                        Guardar equivalencia
                      </Button>
                    </div>
                  )}
                </fieldset>
              )}
              <details>
                <summary>
                  Historial de equivalencias de las filas visibles ({data.historial.length})
                </summary>
                {data.historial.map((h) => (
                  <p key={h.id} className="border-hover border-t py-2">
                    Versión {h.version} · {new Date(h.fecha).toLocaleString('es-ES')} · {h.accion} ·{' '}
                    {h.alcance} · {h.destino.origen} → {h.destino.destino ?? 'sin destino'} ·{' '}
                    {h.motivo} · Autor: {h.autor}
                  </p>
                ))}
              </details>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </div>
      )}
    </details>
  );
}

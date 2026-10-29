'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { ImportacionSummary } from './types/importaciones.types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

type Choice = {
  filaId: string;
  servicio: string;
  finanzas: string;
  tipoOperacion?: string;
  suscripcionId?: string;
  grupoId?: string;
  servicioDistinto?: boolean;
  referenciaPropia?: string;
};
type Row = {
  id: string;
  hoja: string;
  fila: number;
  nombre: string;
  identidad: string;
  suscripcion: string;
  finanzas: string;
  excluida: boolean;
  clienteId: string | null;
  suscripcionId: string | null;
  renovacionId: string | null;
  importeAnual: number | null;
  fechaInicioPropuesta: string | null;
  fechaFin: string | null;
  candidatos: Array<{
    id: string;
    servidor: string;
    fechaInicio: string;
    fechaFin: string;
    estado: string;
  }>;
};
type Batch = {
  id: string;
  estado: string;
  motivo: string;
  fecha: string;
  propuesta: {
    resumen: {
      filas: number;
      clientesNuevos: number;
      clientesExistentes: number;
      referenciasNuevas: number;
      suscripcionesNuevas: number;
      operaciones: number;
      ingresos: number;
      deuda: number;
      gratuitas: number;
    };
    bloqueos: Array<{ filaId: string; hoja: string; fila: number; motivos: string[] }>;
    clientes: Array<{
      identidadId: string;
      nombre: string;
      referencia: string;
      referenciaId: string | null;
      crear: boolean;
    }>;
    filas: Array<{
      filaId: string;
      hoja: string;
      fila: number;
      nombre: string;
      servicio: string;
      finanzas: string;
      tipoOperacion: string | null;
      destino: string | null;
      producto: string | null;
      tarifa: string | null;
      servidor: string | null;
      referencia: string | null;
      metodoPago?: string | null;
      fechaInicio: string | null;
      fechaFin: string | null;
      importe: number | null;
      historica: boolean;
    }>;
  };
  resultado: {
    clientesNuevos: number;
    suscripcionesNuevas: number;
    operaciones: number;
    movimientos: number;
    filas: Array<{
      filaId: string;
      clienteId: string;
      suscripcionId: string | null;
      renovacionId: string | null;
      movimientoId: string | null;
    }>;
  } | null;
};
type Result = {
  huellaRevision: string;
  hojas: string[];
  data: Row[];
  pagination: { total: number; totalPages: number };
  lotes: Batch[];
  lotesPagination?: { page: number; total: number; totalPages: number };
};
const selectClass = 'rounded-input border border-hover bg-background p-2 max-w-full';
const money = (value: number) =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export function ApplicationReview({
  importId,
  onUpdate,
}: {
  importId: string;
  onUpdate?: (summary: ImportacionSummary) => void;
}) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [sheet, setSheet] = useState(''),
    [page, setPage] = useState(1),
    [batchPage, setBatchPage] = useState(1),
    [historyOpen, setHistoryOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({}),
    [revision, setRevision] = useState('');
  const [reason, setReason] = useState(''),
    [batch, setBatch] = useState<Batch | null>(null);
  const [confirmed, setConfirmed] = useState(false),
    [financeConfirmed, setFinanceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const review = useQuery<Result>({
    queryKey: ['importacion', importId, 'aplicacion', sheet, page, batchPage],
    enabled: open,
    placeholderData: (previous) => previous,
    queryFn: () =>
      api
        .get(`/importaciones/${importId}/aplicacion`, {
          params: { page, limit: 25, hoja: sheet || undefined, lotesPage: batchPage },
        })
        .then((r) => r.data),
  });
  const data = review.data,
    selected = Object.values(choices);
  const stale = !!selected.length && revision !== data?.huellaRevision;
  const clearPreview = () => {
    setBatch(null);
    setConfirmed(false);
    setFinanceConfirmed(false);
    setError('');
  };
  const change = (row: Row, values: Partial<Choice>) => {
    clearPreview();
    setChoices((old) => ({ ...old, [row.id]: { ...old[row.id], ...values } }));
  };
  const propose = async () => {
    if (!data || stale) return;
    setBusy(true);
    clearPreview();
    try {
      setBatch(
        (
          await api.post<Batch>(`/importaciones/${importId}/lotes`, {
            solicitudId: crypto.randomUUID(),
            huellaRevision: revision,
            filas: selected,
            motivo: reason.trim(),
          })
        ).data,
      );
      await review.refetch();
    } catch (e) {
      setError(catalogError(e));
      await review.refetch();
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!batch) return;
    setBusy(true);
    setError('');
    try {
      setBatch(
        (
          await api.post<Batch>(`/importaciones/${importId}/lotes/${batch.id}/confirmar`, {
            confirmar: confirmed,
            confirmarFinanzas: financeConfirmed,
          })
        ).data,
      );
      setChoices({});
      setRevision('');
      await cache.invalidateQueries();
      if (onUpdate) {
        try {
          onUpdate(
            (await api.get<{ data: ImportacionSummary }>(`/importaciones/${importId}`)).data.data,
          );
        } catch {
          setError(
            'El lote está aplicado. No se pudo actualizar el resumen; vuelve a abrir el análisis.',
          );
        }
      }
    } catch (e) {
      setError(catalogError(e));
      await review.refetch();
    } finally {
      setBusy(false);
    }
  };
  const resume = (value: Batch) => {
    setBatch(value);
    setConfirmed(false);
    setFinanceConfirmed(false);
    setError('');
  };
  return (
    <details
      className="rounded-card border-hover border p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        12.4 · Confirmar e importar datos revisados
      </summary>
      {open && (
        <div className="mt-4 space-y-4">
          <p>
            Selecciona hasta 500 filas por lote. Puedes importar clientes y servicios dejando las
            contabilidad pendiente. Los datos ausentes del cliente se guardan vacíos; los clientes
            nuevos se crean activos.
          </p>
          <p>
            FECHA indica el vencimiento. El inicio y la fecha de la operación histórica corresponden
            a FECHA menos un año. P.AÑO es el importe; TOTAL no genera ingresos. PE solo permite
            deuda pendiente; PA se ignora.
          </p>
          {review.isPending && <p>Cargando datos para importar…</p>}
          {review.error && <p role="alert">{catalogError(review.error)}</p>}
          {data && (
            <>
              <fieldset disabled={busy || review.isPlaceholderData} className="space-y-3">
                <label>
                  Hoja{' '}
                  <select
                    aria-label="Hoja para importar"
                    className={selectClass}
                    value={sheet}
                    onChange={(e) => {
                      setSheet(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Todas</option>
                    {data.hojas.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>{' '}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setChoices({});
                    setRevision('');
                    clearPreview();
                    void review.refetch();
                  }}
                >
                  Actualizar selección de importación
                </Button>
                {data.data.map((row) => {
                  const c = choices[row.id];
                  return (
                    <article
                      key={row.id}
                      className="border-hover space-y-2 border-t py-3"
                      aria-label={`Importar ${row.hoja} ${row.fila}`}
                    >
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${row.hoja} ${row.fila}`}
                          checked={!!c}
                          disabled={
                            row.excluida || !!row.renovacionId || (!c && selected.length >= 500)
                          }
                          onChange={(e) => {
                            clearPreview();
                            if (!selected.length) setRevision(data.huellaRevision);
                            setChoices((old) => {
                              const next = { ...old };
                              if (e.target.checked)
                                next[row.id] = {
                                  filaId: row.id,
                                  servicio: row.suscripcionId ? 'CONSERVAR' : 'NINGUNO',
                                  finanzas: 'NINGUNA',
                                };
                              else delete next[row.id];
                              return next;
                            });
                          }}
                        />{' '}
                        {row.hoja} · {row.fila} · {row.nombre || 'Identidad pendiente'}
                      </label>
                      <p className="text-sm">
                        Identidad: {row.identidad} · Servicio: {row.suscripcion} · Contabilidad:{' '}
                        {row.finanzas}. Periodo: {row.fechaInicioPropuesta ?? 'Pendiente'} →{' '}
                        {row.fechaFin ?? 'Pendiente'} · P.AÑO:{' '}
                        {row.importeAnual === null ? 'Pendiente' : money(row.importeAnual)}.
                      </p>
                      {row.clienteId && (
                        <p>
                          <Link className="underline" href={`/clientes/${row.clienteId}`}>
                            Ver cliente
                          </Link>
                          {row.suscripcionId && (
                            <>
                              {' '}
                              ·{' '}
                              <Link
                                className="underline"
                                href={`/suscripciones/${row.suscripcionId}`}
                              >
                                Ver servicio importado
                              </Link>
                            </>
                          )}
                          {row.renovacionId && (
                            <>
                              {' '}
                              ·{' '}
                              <Link
                                className="underline"
                                href={`/renovaciones/${row.renovacionId}`}
                              >
                                Ver operación importada
                              </Link>
                            </>
                          )}
                        </p>
                      )}
                      {c && (
                        <div className="space-y-2">
                          <label>
                            Servicio{' '}
                            <select
                              aria-label={`Servicio ${row.hoja} ${row.fila}`}
                              className={selectClass}
                              value={c.servicio}
                              onChange={(e) =>
                                change(row, {
                                  servicio: e.target.value,
                                  suscripcionId: undefined,
                                  grupoId: undefined,
                                  servicioDistinto: false,
                                  finanzas: 'NINGUNA',
                                  tipoOperacion: undefined,
                                })
                              }
                            >
                              {!row.suscripcionId && (
                                <>
                                  <option value="NINGUNO">Solo cliente</option>
                                  <option value="NUEVO">Crear servicio nuevo</option>
                                  <option value="VINCULAR">Vincular servicio existente</option>
                                </>
                              )}
                              {row.suscripcionId && (
                                <option value="CONSERVAR">Conservar servicio importado</option>
                              )}
                            </select>
                          </label>{' '}
                          {c.servicio === 'VINCULAR' && (
                            <label>
                              Destino{' '}
                              <select
                                aria-label={`Destino ${row.hoja} ${row.fila}`}
                                className={selectClass}
                                value={c.suscripcionId ?? ''}
                                onChange={(e) =>
                                  change(row, { suscripcionId: e.target.value || undefined })
                                }
                              >
                                <option value="">Selecciona servicio</option>
                                {row.candidatos.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.servidor} · {s.fechaInicio} → {s.fechaFin} · {s.estado} ·{' '}
                                    {s.id}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {c.servicio === 'NUEVO' && (
                            <>
                              <label className="block">
                                <input
                                  type="checkbox"
                                  checked={c.servicioDistinto ?? false}
                                  onChange={(e) =>
                                    change(row, { servicioDistinto: e.target.checked })
                                  }
                                />{' '}
                                He comprobado que es otro servicio, distinto de los existentes y de
                                los demás seleccionados.
                              </label>
                              <p className="text-sm">
                                {c.grupoId
                                  ? `Grupo de servicio: ${c.grupoId}`
                                  : 'Servicio independiente. Agrupa las filas solo si son periodos del mismo servicio.'}
                              </p>
                            </>
                          )}
                          {!row.clienteId && (
                            <label className="block">
                              Nombre de referencia propia (vacío: nombre del cliente)
                              <Input
                                aria-label={`Referencia propia ${row.hoja} ${row.fila}`}
                                maxLength={150}
                                value={c.referenciaPropia ?? ''}
                                onChange={(e) => change(row, { referenciaPropia: e.target.value })}
                              />
                            </label>
                          )}
                          {c.servicio !== 'NINGUNO' && (
                            <>
                              <label>
                                Contabilidad{' '}
                                <select
                                  aria-label={`Contabilidad ${row.hoja} ${row.fila}`}
                                  className={selectClass}
                                  value={c.finanzas}
                                  onChange={(e) =>
                                    change(row, {
                                      finanzas: e.target.value,
                                      tipoOperacion: undefined,
                                    })
                                  }
                                >
                                  <option value="NINGUNA">Dejar pendientes</option>
                                  {row.finanzas === 'PENDIENTE_CONFIRMACION' && (
                                    <option value="COBRADO">Confirmar ingreso cobrado</option>
                                  )}
                                  {row.finanzas === 'PENDIENTE_PAGO' && (
                                    <option value="DEUDA">Registrar deuda pendiente (PE)</option>
                                  )}
                                  {row.finanzas === 'GRATUITO' && (
                                    <option value="GRATIS">Registrar operación gratuita</option>
                                  )}
                                </select>
                              </label>{' '}
                              {c.finanzas !== 'NINGUNA' && (
                                <label>
                                  Operación{' '}
                                  <select
                                    aria-label={`Operación ${row.hoja} ${row.fila}`}
                                    className={selectClass}
                                    value={c.tipoOperacion ?? ''}
                                    onChange={(e) =>
                                      change(row, { tipoOperacion: e.target.value || undefined })
                                    }
                                  >
                                    <option value="">Revisa el tipo</option>
                                    <option value="ALTA">Alta</option>
                                    <option value="RENOVACION">Renovación</option>
                                  </select>
                                </label>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Página anterior de importación
                  </Button>
                  <span>
                    Página {page} de {Math.max(1, data.pagination.totalPages)}
                  </span>
                  <Button
                    disabled={page >= data.pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Página siguiente de importación
                  </Button>
                </div>
                <p>{selected.length} filas seleccionadas en todas las páginas.</p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    disabled={selected.filter((c) => c.servicio === 'NUEVO').length < 2}
                    onClick={() => {
                      clearPreview();
                      const group = crypto.randomUUID();
                      setChoices((old) =>
                        Object.fromEntries(
                          Object.entries(old).map(([id, c]) => [
                            id,
                            c.servicio === 'NUEVO' ? { ...c, grupoId: group } : c,
                          ]),
                        ),
                      );
                    }}
                  >
                    Agrupar seleccionadas como periodos del mismo servicio
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      clearPreview();
                      setChoices((old) =>
                        Object.fromEntries(
                          Object.entries(old).map(([id, c]) => [id, { ...c, grupoId: undefined }]),
                        ),
                      );
                    }}
                  >
                    Separar servicios seleccionados
                  </Button>
                </div>
                <label className="block">
                  Motivo del lote
                  <Input
                    aria-label="Motivo del lote"
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => {
                      clearPreview();
                      setReason(e.target.value);
                    }}
                  />
                </label>
                {stale && (
                  <p role="alert">
                    Los datos han cambiado. Actualiza la selección y revisa de nuevo las filas.
                  </p>
                )}
                <Button
                  disabled={
                    !selected.length ||
                    stale ||
                    reason.trim().length < 3 ||
                    selected.some((c) => c.finanzas !== 'NINGUNA' && !c.tipoOperacion)
                  }
                  onClick={() => void propose()}
                >
                  Previsualizar lote
                </Button>
              </fieldset>
              <details
                open={historyOpen}
                onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
              >
                <summary>
                  Lotes guardados ({data.lotesPagination?.total ?? data.lotes.length})
                </summary>
                {data.lotes.map((b) => (
                  <p key={b.id}>
                    <Button variant="secondary" disabled={busy} onClick={() => resume(b)}>
                      Abrir lote {b.id}
                    </Button>{' '}
                    {b.estado} · {new Date(b.fecha).toLocaleString('es-ES')} · {b.motivo}
                  </p>
                ))}
                {(data.lotesPagination?.totalPages ?? 0) > 1 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={busy || review.isPlaceholderData || batchPage === 1}
                      onClick={() => setBatchPage(batchPage - 1)}
                    >
                      Lotes anteriores
                    </Button>
                    <span>
                      Página de lotes {batchPage} de {data.lotesPagination?.totalPages}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={
                        busy ||
                        review.isPlaceholderData ||
                        batchPage >= (data.lotesPagination?.totalPages ?? 1)
                      }
                      onClick={() => setBatchPage(batchPage + 1)}
                    >
                      Lotes siguientes
                    </Button>
                  </div>
                )}
              </details>
            </>
          )}
          {batch && (
            <section
              aria-label="Propuesta de importación"
              className="border-hover space-y-3 border p-3"
            >
              <p>
                Lote {batch.id} · {batch.estado} · {batch.motivo}
              </p>
              <p>
                {batch.propuesta.resumen.filas} filas · {batch.propuesta.resumen.clientesNuevos}{' '}
                clientes nuevos · {batch.propuesta.resumen.clientesExistentes} existentes ·{' '}
                {batch.propuesta.resumen.referenciasNuevas} referencias nuevas ·{' '}
                {batch.propuesta.resumen.suscripcionesNuevas} servicios nuevos ·{' '}
                {batch.propuesta.resumen.operaciones} operaciones.
              </p>
              <p>
                Ingresos confirmados: {money(batch.propuesta.resumen.ingresos)} · Deuda pendiente:{' '}
                {money(batch.propuesta.resumen.deuda)} · Operaciones gratuitas:{' '}
                {batch.propuesta.resumen.gratuitas}.
              </p>
              {batch.propuesta.clientes.map((c) => (
                <p key={c.identidadId}>
                  Cliente: {c.nombre} ({c.crear ? 'nuevo, ACTIVO' : 'existente'}) · Referencia
                  propia: {c.referencia} ({c.referenciaId ? 'existente' : 'nueva'}).
                </p>
              ))}
              <details>
                <summary>Revisar todas las filas del lote</summary>
                <ul>
                  {batch.propuesta.filas.map((r) => (
                    <li className="border-hover border-t py-2" key={r.filaId}>
                      {r.hoja} {r.fila} · {r.nombre} · {r.servicio} · {r.destino ?? 'Sin servicio'}{' '}
                      · {r.producto ?? 'Pendiente'} · {r.tarifa ?? 'Pendiente'} ·{' '}
                      {r.servidor ?? 'Pendiente'} · Referencia de origen: {r.referencia ?? 'vacía'}{' '}
                      · Método de pago: {r.metodoPago ?? 'No consta en esta propuesta'} ·{' '}
                      {r.fechaInicio ?? '—'} → {r.fechaFin ?? '—'} · {r.finanzas} ·{' '}
                      {r.tipoOperacion ?? '—'} ·{' '}
                      {r.importe === null ? 'Pendiente' : money(r.importe)}
                      {r.historica && ' · HISTÓRICA: sin renovaciones ni recordatorios operativos.'}
                    </li>
                  ))}
                </ul>
              </details>
              {batch.propuesta.bloqueos.map((b, i) => (
                <p role="alert" key={`${b.filaId}-${i}`}>
                  {b.hoja} {b.fila}: {b.motivos.join(' ')}
                </p>
              ))}
              {batch.estado !== 'APLICADO' && (
                <>
                  <p>
                    La confirmación crea los datos indicados de forma conjunta. Si alguna
                    comprobación falla, no se importa ninguna fila de este lote.
                  </p>
                  <label className="block">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{' '}
                    He revisado los clientes, servicios, agrupaciones y fechas del lote.
                  </label>
                  {batch.propuesta.resumen.operaciones > 0 && (
                    <label className="block">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={financeConfirmed}
                        onChange={(e) => setFinanceConfirmed(e.target.checked)}
                      />{' '}
                      Confirmo expresamente los importes, tipos de operación, cobros y deudas
                      indicados.
                    </label>
                  )}
                  <Button
                    disabled={
                      busy ||
                      !confirmed ||
                      batch.propuesta.bloqueos.length > 0 ||
                      (batch.propuesta.resumen.operaciones > 0 && !financeConfirmed)
                    }
                    onClick={() => void confirm()}
                  >
                    Confirmar importación del lote
                  </Button>
                </>
              )}
              {batch.resultado && (
                <div role="status">
                  <p>
                    Importación completada: {batch.resultado.clientesNuevos} clientes nuevos,{' '}
                    {batch.resultado.suscripcionesNuevas} servicios nuevos,{' '}
                    {batch.resultado.operaciones} operaciones y {batch.resultado.movimientos}{' '}
                    movimientos. Este lote ya está aplicado; volver a abrirlo no duplica datos.
                  </p>
                  {batch.resultado.filas.map((r) => (
                    <p key={r.filaId}>
                      <Link className="underline" href={`/clientes/${r.clienteId}`}>
                        Cliente
                      </Link>
                      {r.suscripcionId && (
                        <>
                          {' '}
                          ·{' '}
                          <Link className="underline" href={`/suscripciones/${r.suscripcionId}`}>
                            Servicio
                          </Link>
                        </>
                      )}
                      {r.renovacionId && (
                        <>
                          {' '}
                          ·{' '}
                          <Link className="underline" href={`/renovaciones/${r.renovacionId}`}>
                            Operación
                          </Link>
                        </>
                      )}
                      {r.movimientoId && (
                        <>
                          {' '}
                          ·{' '}
                          <Link className="underline" href={`/finanzas/${r.movimientoId}`}>
                            Movimiento
                          </Link>
                        </>
                      )}
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}

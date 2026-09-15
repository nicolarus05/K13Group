'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useClientes } from '@/modules/clientes/hooks/use-clientes';
import {
  useConfirmImportacion,
  useImportacionCatalogs,
  useImportacionRows,
  usePendingImportacionValues,
  usePreviewImportacion,
  useReconcileImportacion,
  useReviewImportacionRow,
} from '@/modules/importaciones/hooks/use-importaciones';
import type { ImportacionSummary } from '@/modules/importaciones/types/importaciones.types';

type ReviewForm = {
  clienteId: string;
  productoId: string;
  tarifaId: string;
  servidorId: string;
  referenciaId: string;
  metodoPagoId: string;
  observacion: string;
};

const emptyForm: ReviewForm = { clienteId: '', productoId: '', tarifaId: '', servidorId: '', referenciaId: '', metodoPagoId: '', observacion: '' };

export default function ImportacionesPage() {
  const { success, error } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportacionSummary | null>(null);
  const [allowWarnings, setAllowWarnings] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>('');
  const [form, setForm] = useState<ReviewForm>(emptyForm);
  const previewMutation = usePreviewImportacion();
  const confirmMutation = useConfirmImportacion();
  const reconcileMutation = useReconcileImportacion();
  const importId = preview?.importacionId;
  const rowsQuery = useImportacionRows(importId, { page, limit: 20 });
  const catalogsQuery = useImportacionCatalogs(importId);
  const pendingQuery = usePendingImportacionValues(importId);
  const reviewMutation = useReviewImportacionRow(importId ?? '');
  const clientsQuery = useClientes({ limit: 100, sort: 'nombre:asc' });
  const rows = useMemo(() => rowsQuery.data?.data ?? [], [rowsQuery.data]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const catalogs = catalogsQuery.data;

  useEffect(() => {
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    if (selectedId && !selectedRow && rows[0]) setSelectedId(rows[0].id);
  }, [rows, selectedId, selectedRow]);

  useEffect(() => {
    if (!selectedRow) return;
    setForm({
      clienteId: selectedRow.clienteId ?? selectedRow.mapeo?.clienteId ?? '',
      productoId: selectedRow.mapeo?.productoId ?? '',
      tarifaId: selectedRow.mapeo?.tarifaId ?? '',
      servidorId: selectedRow.mapeo?.servidorId ?? '',
      referenciaId: selectedRow.mapeo?.referenciaId ?? '',
      metodoPagoId: selectedRow.mapeo?.metodoPagoId ?? '',
      observacion: selectedRow.observacionRevision ?? '',
    });
  }, [selectedRow]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setSelectedId('');
    setPage(1);
  }

  async function handlePreview() {
    if (!file) return;
    try { setPreview(await previewMutation.mutateAsync(file)); }
    catch { error('No se pudo analizar el Excel.', 'Comprueba que sea el archivo CLIENTES 2026 actualizado.'); }
  }

  async function handleConfirm() {
    if (!preview) return;
    try {
      const result = await confirmMutation.mutateAsync({ id: preview.importacionId, permitirAdvertencias: allowWarnings });
      setPreview(result); success('Importación confirmada.', `${result.clientesNuevos} clientes nuevos procesados. Ahora puedes revisar las filas.`);
    } catch { error('No se pudo confirmar la importación.', 'Revisa y acepta las advertencias antes de continuar.'); }
  }

  async function handleReview(decision: 'ACEPTAR' | 'RECHAZAR' | 'PENDIENTE') {
    if (!selectedRow || !importId) return;
    try {
      await reviewMutation.mutateAsync({ rowId: selectedRow.id, data: { decision, ...form, clienteId: form.clienteId || undefined, productoId: form.productoId || undefined, tarifaId: form.tarifaId || undefined, servidorId: form.servidorId || undefined, referenciaId: form.referenciaId || undefined, metodoPagoId: form.metodoPagoId || undefined } });
      success('Fila revisada.', decision === 'ACEPTAR' ? 'Queda preparada para reconciliar.' : 'La decisión ha quedado auditada.');
      setSelectedId('');
    } catch { error('No se pudo guardar la revisión.', 'Comprueba que las relaciones seleccionadas sean válidas.'); }
  }

  async function handleReconcile(confirmFinance: boolean) {
    if (!importId || !window.confirm(confirmFinance ? 'Se crearán suscripciones, renovaciones y movimientos financieros para las filas aceptadas. ¿Continuar?' : 'Se crearán suscripciones; los movimientos financieros quedarán pendientes. ¿Continuar?')) return;
    try {
      const result = await reconcileMutation.mutateAsync({ id: importId, confirmarFinanzas: confirmFinance });
      setPreview(result); success('Reconciliación ejecutada.', `${result.movimientosCreados} movimientos financieros creados.`);
    } catch { error('No se pudo reconciliar la importación.', 'Revisa las equivalencias y las reglas financieras antes de continuar.'); }
  }

  const canConfirm = preview?.estado === 'EN_REVISION' && (allowWarnings || preview.advertencias === 0);
  const isConfirmed = Boolean(preview && preview.estado !== 'EN_REVISION');
  const normalized = selectedRow?.datosNormalizados ?? {};
  const setField = (field: keyof ReviewForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Importar y reconciliar clientes</h1>
        <p className="mt-1 text-sm text-text-secondary">El histórico conserva el Excel original y exige una decisión explícita antes de crear operaciones.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Analizar archivo</CardTitle><Badge variant="default">Sin cambios operativos</Badge></CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-hover p-8 text-center hover:bg-hover/30">
            <FileSpreadsheet className="mb-3 h-8 w-8 text-success" />
            <span className="text-sm font-medium text-text-main">{file?.name ?? 'Selecciona el Excel de clientes'}</span>
            <span className="mt-1 text-xs text-text-secondary">Formato .xlsx o .xls · máximo 10 MB</span>
            <input className="sr-only" type="file" accept=".xlsx,.xls" onChange={selectFile} />
          </label>
          <div className="mt-4 flex justify-end"><Button onClick={handlePreview} disabled={!file} loading={previewMutation.isPending}><Upload className="h-4 w-4" />Analizar archivo</Button></div>
        </CardContent>
      </Card>

      {preview && <>
        <Card>
          <CardHeader><CardTitle>2. Estado de la importación</CardTitle><Badge variant={preview.errores ? 'danger' : preview.filasPendientesReconciliacion ? 'warning' : 'success'}>{preview.estado}</Badge></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Filas operativas" value={preview.filas} /><Metric label="Clientes nuevos" value={preview.clientesNuevos} /><Metric label="Posibles repetidos" value={preview.posiblesDuplicados} /><Metric label="Pendientes" value={preview.filasPendientesReconciliacion} /><Metric label="Movimientos creados" value={preview.movimientosCreados} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><Notice icon={<AlertTriangle className="h-4 w-4" />} label="Advertencias" value={preview.advertencias} /><Notice icon={<CheckCircle2 className="h-4 w-4" />} label="Errores bloqueantes" value={preview.errores} /></div>
          </CardContent>
        </Card>

        {!isConfirmed && <Card><CardHeader><CardTitle>3. Confirmar staging y clientes</CardTitle></CardHeader><CardContent>
          <label className="flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" className="mt-0.5 accent-primary" checked={allowWarnings} onChange={(event) => setAllowWarnings(event.target.checked)} />Acepto las advertencias no bloqueantes. Las operaciones seguirán pendientes hasta su revisión.</label>
          <div className="mt-4 flex justify-end"><Button onClick={handleConfirm} disabled={!canConfirm} loading={confirmMutation.isPending}>Confirmar staging y guardar clientes</Button></div>
        </CardContent></Card>}

        {isConfirmed && <>
          <div className="grid gap-5 lg:grid-cols-[1.05fr_1.4fr]">
            <Card><CardHeader><CardTitle>3. Filas pendientes</CardTitle></CardHeader><CardContent>
              <div className="mb-3 flex items-center justify-between text-xs text-text-secondary"><span>{rowsQuery.data?.pagination.total ?? 0} filas en esta vista</span><Button variant="ghost" size="sm" onClick={() => { rowsQuery.refetch(); pendingQuery.refetch(); }}><RefreshCw className="h-3.5 w-3.5" />Actualizar</Button></div>
              <div className="max-h-[520px] overflow-auto rounded-input border border-hover">
                {rows.length ? rows.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`block w-full border-b border-hover/60 px-3 py-3 text-left text-sm last:border-b-0 ${row.id === selectedId ? 'bg-primary/10' : 'hover:bg-hover/40'}`}><div className="flex items-center justify-between"><span className="font-medium text-text-main">{String(row.datosNormalizados.nombre ?? 'Sin nombre')}</span><Badge variant={row.estado === 'EN_CONFLICTO' ? 'danger' : 'warning'}>{row.estado}</Badge></div><p className="mt-1 text-xs text-text-secondary">{row.hojaOrigen} · fila {row.filaOrigen} · {String(row.datosNormalizados.app ?? 'APP sin valor')}</p></button>) : <p className="p-5 text-sm text-text-secondary">No hay filas pendientes en esta página.</p>}
              </div>
              {rowsQuery.data?.pagination.totalPages && rowsQuery.data.pagination.totalPages > 1 && <div className="mt-3 flex items-center justify-between"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button><span className="text-xs text-text-secondary">Página {page} de {rowsQuery.data.pagination.totalPages}</span><Button size="sm" variant="secondary" disabled={page >= rowsQuery.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</Button></div>}
            </CardContent></Card>

            <Card><CardHeader><CardTitle>4. Revisar fila</CardTitle></CardHeader><CardContent>{selectedRow ? <>
              <div className="mb-4 rounded-input bg-background p-3 text-sm"><p className="font-medium text-text-main">{String(normalized.nombre ?? 'Sin nombre')}</p><p className="mt-1 text-xs text-text-secondary">Próxima renovación: {String(normalized.fecha ?? 'Fecha sin valor')} · P.AÑO: {String(normalized.importeAnual ?? '—')} · TOTAL acumulado: {String(normalized.total ?? '—')} · pago: {String(normalized.pago ?? '—')}</p><p className="mt-1 text-xs text-text-secondary">Advertencias: {selectedRow.advertencias?.join(' · ') || 'ninguna'}</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Cliente" value={form.clienteId} onChange={(value) => setField('clienteId', value)} options={(clientsQuery.data?.data ?? []).map((client) => ({ value: client.id, label: `${client.nombre}${client.telefono ? ` · ${client.telefono}` : ''}` }))} placeholder="Seleccionar cliente" />
                <Select label="Producto" value={form.productoId} onChange={(value) => setField('productoId', value)} options={(catalogs?.productos ?? []).map((item) => ({ value: item.id, label: item.nombre }))} placeholder="Seleccionar producto" />
                <Select label="Tarifa" value={form.tarifaId} onChange={(value) => setField('tarifaId', value)} options={(catalogs?.tarifas ?? []).map((item) => ({ value: item.id, label: `${item.producto.nombre} · ${item.nombre}` }))} placeholder="Seleccionar tarifa" />
                <Select label="Servidor" value={form.servidorId} onChange={(value) => setField('servidorId', value)} options={(catalogs?.servidores ?? []).map((item) => ({ value: item.id, label: item.nombre }))} placeholder="Seleccionar servidor" />
                <Select label="Referencia" value={form.referenciaId} onChange={(value) => setField('referenciaId', value)} options={(catalogs?.referencias ?? []).map((item) => ({ value: item.id, label: item.nombre }))} placeholder="Opcional" />
                <Select label="Método de pago" value={form.metodoPagoId} onChange={(value) => setField('metodoPagoId', value)} options={(catalogs?.metodosPago ?? []).map((item) => ({ value: item.id, label: item.nombre }))} placeholder="Seleccionar método" />
              </div>
              <div className="mt-3"><Input label="Observación de revisión" value={form.observacion} onChange={(event) => setField('observacion', event.target.value)} placeholder="Motivo o decisión aplicada" /></div>
              <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => handleReview('PENDIENTE')} loading={reviewMutation.isPending}>Dejar pendiente</Button><Button variant="danger" onClick={() => handleReview('RECHAZAR')} loading={reviewMutation.isPending}>Rechazar</Button><Button onClick={() => handleReview('ACEPTAR')} loading={reviewMutation.isPending}>Aceptar fila</Button></div>
            </> : <p className="text-sm text-text-secondary">Selecciona una fila para comenzar la revisión.</p>}</CardContent></Card>
          </div>

          <Card><CardHeader><CardTitle>5. Valores sin equivalencia</CardTitle></CardHeader><CardContent><p className="mb-3 text-sm text-text-secondary">Estos valores deben resolverse en los catálogos antes de aceptar filas. El valor original siempre se conserva.</p><div className="flex flex-wrap gap-2">{(pendingQuery.data ?? []).slice(0, 30).map((item) => <Badge key={`${item.tipo}-${item.valorClave}`} variant="warning">{item.tipo}: {item.valorOrigen} ({item.filas})</Badge>)}{!pendingQuery.data?.length && <span className="text-sm text-success">No quedan valores pendientes detectados.</span>}</div></CardContent></Card>

          <Card><CardHeader><CardTitle>6. Reconciliar operaciones</CardTitle></CardHeader><CardContent><p className="text-sm text-text-secondary">Solo se procesan filas aceptadas. La opción financiera requiere confirmar que FECHA, TOTAL y PAGO representan un ingreso histórico y no otro concepto.</p><div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => handleReconcile(false)} loading={reconcileMutation.isPending}>Crear suscripciones, dejar finanzas pendientes</Button><Button onClick={() => handleReconcile(true)} loading={reconcileMutation.isPending}>Crear operaciones financieras</Button></div></CardContent></Card>
        </>}
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-input bg-background p-3"><p className="text-xs text-text-secondary">{label}</p><p className="mt-1 text-xl font-semibold text-text-main">{value.toLocaleString('es-ES')}</p></div>; }
function Notice({ icon, label, value }: { icon: ReactNode; label: string; value: number }) { return <div className="flex items-center gap-2 rounded-input bg-background p-3 text-sm text-text-secondary">{icon}<span>{label}: <strong className="text-text-main">{value.toLocaleString('es-ES')}</strong></span></div>; }

'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import {
  useConfirmImportacion,
  usePreviewImportacion,
} from '@/modules/importaciones/hooks/use-importaciones';
import type { ImportacionSummary } from '@/modules/importaciones/types/importaciones.types';

export default function ImportacionesPage() {
  const { success, error } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportacionSummary | null>(null);
  const [allowWarnings, setAllowWarnings] = useState(false);
  const previewMutation = usePreviewImportacion();
  const confirmMutation = useConfirmImportacion();

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
  }

  async function handlePreview() {
    if (!file) return;
    try {
      setPreview(await previewMutation.mutateAsync(file));
    } catch {
      error('No se pudo analizar el Excel.', 'Comprueba que sea el archivo CLIENTES 2026 actualizado.');
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    try {
      const result = await confirmMutation.mutateAsync({
        id: preview.importacionId,
        permitirAdvertencias: allowWarnings,
      });
      setPreview(result);
      success('Importación confirmada.', `${result.clientesNuevos} clientes nuevos procesados.`);
    } catch {
      error('No se pudo confirmar la importación.', 'Revisa las advertencias antes de continuar.');
    }
  }

  const canConfirm = preview && preview.estado === 'EN_REVISION' && (allowWarnings || preview.advertencias === 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Importar clientes</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Analiza, revisa y confirma CLIENTES 2026 sin contabilizar datos ambiguos automáticamente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Seleccionar archivo</CardTitle>
          <Badge variant="default">Sin cambios hasta confirmar</Badge>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-hover p-8 text-center hover:bg-hover/30">
            <FileSpreadsheet className="mb-3 h-8 w-8 text-success" />
            <span className="text-sm font-medium text-text-main">
              {file?.name ?? 'Selecciona el Excel de clientes'}
            </span>
            <span className="mt-1 text-xs text-text-secondary">Formato .xlsx o .xls · máximo 10 MB</span>
            <input className="sr-only" type="file" accept=".xlsx,.xls" onChange={selectFile} />
          </label>
          <div className="mt-4 flex justify-end">
            <Button onClick={handlePreview} disabled={!file} loading={previewMutation.isPending}>
              <Upload className="h-4 w-4" />
              Analizar archivo
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Resultado de la previsualización</CardTitle>
              <Badge variant={preview.errores ? 'danger' : preview.advertencias ? 'warning' : 'success'}>
                {preview.estado}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Filas operativas" value={preview.filas} />
                <Metric label="Clientes nuevos" value={preview.clientesNuevos} />
                <Metric label="Posibles repetidos" value={preview.posiblesDuplicados} />
                <Metric label="Pendientes de conciliación" value={preview.filasPendientesReconciliacion} />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Notice icon={<AlertTriangle className="h-4 w-4" />} label="Advertencias" value={preview.advertencias} />
                <Notice icon={<CheckCircle2 className="h-4 w-4" />} label="Errores bloqueantes" value={preview.errores} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Revisar hojas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-hover text-xs text-text-secondary">
                    <tr><th className="px-2 py-2">Hoja</th><th className="px-2 py-2">Filas</th><th className="px-2 py-2">Advertencias</th><th className="px-2 py-2">Errores</th></tr>
                  </thead>
                  <tbody>
                    {preview.hojas.map((sheet) => (
                      <tr key={sheet.hoja} className="border-b border-hover/50">
                        <td className="px-2 py-2 font-medium text-text-main">{sheet.hoja}</td>
                        <td className="px-2 py-2 text-text-secondary">{sheet.filas}</td>
                        <td className="px-2 py-2 text-warning">{sheet.advertencias}</td>
                        <td className="px-2 py-2 text-danger">{sheet.errores}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Confirmar importación</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex items-start gap-3 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={allowWarnings}
                  onChange={(event) => setAllowWarnings(event.target.checked)}
                />
                Permitir advertencias no bloqueantes. Las filas sin datos financieros completos quedarán pendientes de conciliación.
              </label>
              <div className="mt-4 flex justify-end">
                <Button onClick={handleConfirm} disabled={!canConfirm} loading={confirmMutation.isPending}>
                  Confirmar y guardar clientes
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-input bg-background p-3"><p className="text-xs text-text-secondary">{label}</p><p className="mt-1 text-xl font-semibold text-text-main">{value.toLocaleString('es-ES')}</p></div>;
}

function Notice({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <div className="flex items-center gap-2 rounded-input bg-background p-3 text-sm text-text-secondary">{icon}<span>{label}: <strong className="text-text-main">{value.toLocaleString('es-ES')}</strong></span></div>;
}

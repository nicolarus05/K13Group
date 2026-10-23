'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { isAxiosError } from 'axios';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function ExportButton({
  module,
  filters = {},
  section,
}: {
  module: string;
  filters?: object;
  section?: string;
}) {
  const [format, setFormat] = useState('xlsx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const filtros = Object.fromEntries(
        Object.entries(filters).filter(
          ([k, v]) => !['page', 'limit'].includes(k) && v !== undefined && v !== null && v !== '',
        ),
      );
      const response = await api.post(
        `/exportaciones/${module}`,
        { formato: format, filtros, ...(section ? { seccion: section } : {}) },
        { responseType: 'blob', timeout: 65000 },
      );
      const url = URL.createObjectURL(response.data as Blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = /filename="([^"]+)"/.exec(
        response.headers['content-disposition'] ?? '',
      )?.[1];
      anchor.download = filename ?? `k13-${module}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
    } catch (cause) {
      let message = 'No se pudo descargar el archivo. Reintenta en unos segundos.';
      if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
        try {
          const body = JSON.parse(await cause.response.data.text());
          if (typeof body.message === 'string') message = body.message;
        } catch {
          /* Keep the readable fallback for non-JSON server errors. */
        }
      }
      setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Exportación de datos" className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Formato de exportación{' '}
          <select
            aria-label="Formato de exportación"
            className="rounded border p-2"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            disabled={busy}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <Button variant="secondary" onClick={() => void download()} disabled={busy}>
          {busy ? 'Generando archivo…' : 'Exportar'}
        </Button>
        <Link href="/exportaciones" className="text-primary underline">
          Historial de exportaciones
        </Link>
      </div>
      <p className="text-sm">
        Todos los resultados con los filtros actuales. Máximo{' '}
        {format === 'pdf' ? '1.000' : '10.000'} registros.
      </p>
      {busy && <p role="status">Preparando la descarga…</p>}
      {done && <p role="status">Archivo generado. Descarga iniciada.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

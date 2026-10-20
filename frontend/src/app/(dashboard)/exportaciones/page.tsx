'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

type ExportRecord = {
  id: string;
  tipo: string;
  modulo: string | null;
  seccion: string | null;
  estado: string;
  registros: number | null;
  createdAt: string;
  error: string | null;
  usuario: { nombre: string };
};
export default function Page() {
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ['exportaciones', page],
    queryFn: () =>
      api
        .get<{ data: ExportRecord[]; pagination: { total: number; limit: number } }>(
          '/exportaciones',
          { params: { page } },
        )
        .then((r) => r.data),
  });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Historial de exportaciones</h1>
      <p>
        Este historial registra la generación del archivo. La descarga se guarda en tu navegador;
        para obtener un archivo actualizado, expórtalo de nuevo desde su módulo.
      </p>
      {result.isPending && <p role="status">Cargando exportaciones…</p>}
      {result.isError && (
        <p role="alert">
          {catalogError(result.error)}{' '}
          <Button onClick={() => void result.refetch()}>Reintentar</Button>
        </p>
      )}
      {result.data && !result.data.data.length && <p>No hay exportaciones registradas.</p>}
      {result.data?.data.map((row) => (
        <article key={row.id} className="space-y-1 rounded border p-3">
          <strong>
            {row.modulo ?? 'Exportación anterior'}
            {row.seccion ? ` · ${row.seccion}` : ''} · {row.tipo.toUpperCase()}
          </strong>
          <p>
            {new Date(row.createdAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} ·{' '}
            {row.usuario.nombre}
          </p>
          <p>
            {row.estado === 'GENERADA'
              ? 'Archivo generado'
              : row.estado === 'FALLIDA'
                ? 'Generación fallida'
                : 'Generación iniciada, sin resultado confirmado'}
            {row.registros !== null ? ` · ${row.registros} registros` : ''}
          </p>
          {row.error && <p>{row.error}</p>}
        </article>
      ))}
      {result.data && (
        <div className="flex items-center gap-3">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span>
            Página {page} · {result.data.pagination.total} exportaciones
          </span>
          <Button
            disabled={page * result.data.pagination.limit >= result.data.pagination.total}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

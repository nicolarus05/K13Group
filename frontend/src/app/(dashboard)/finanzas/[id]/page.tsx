'use client';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

import { money } from '@/modules/renovaciones/renovaciones.service';
import { finances } from '@/modules/finanzas/finanzas.service';
import { ExpenseDialog, type ExpenseAction } from '@/modules/finanzas/expense-dialog';
export default function Page() {
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const { id } = useParams<{ id: string }>();
  const [action, setAction] = useState<ExpenseAction | null>(null);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['finanzas', id],
    queryFn: () => finances.get(id),
    refetchInterval: action ? false : refreshInterval,
  });
  const history = useQuery({
    queryKey: ['finanzas', id, 'historial', page],
    queryFn: () => finances.history(id, page),
  });
  const row = query.data;
  return (
    <div className="space-y-4">
      <Link className="text-primary underline" href="/finanzas">
        Volver a Finanzas
      </Link>
      <h1 className="text-2xl font-semibold">Detalle del movimiento</h1>
      {query.isPending && <p role="status">Cargando movimiento…</p>}
      {query.isError && (
        <p role="alert">
          {catalogError(query.error)}{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      )}
      {row && (
        <>
          <h2 className="text-xl">{row.concepto ?? row.descripcion ?? row.tipo.etiqueta}</h2>
          <dl className="grid gap-2 md:grid-cols-2">
            {[
              ['Tipo', row.tipo.etiqueta],
              ['Estado', row.estado.etiqueta],
              ['Importe', money(row.importe)],
              ['Fecha financiera', dateLabel(row.fechaCobro ?? row.fecha)],
              [
                'Fecha prevista de cobro',
                row.fechaPrevistaCobro ? dateLabel(row.fechaPrevistaCobro) : '—',
              ],
              ['Categoría', row.categoriaNombreSnapshot ?? row.categoriaGasto?.nombre ?? '—'],
              [
                'Método de pago',
                row.metodoPagoNombreSnapshot ?? row.metodoPago?.nombre ?? 'Sin dato histórico',
              ],
              ['Producto histórico', row.productoNombreSnapshot ?? '—'],
              ['Tarifa histórica', row.tarifaNombreSnapshot ?? '—'],
              ['Servidor histórico', row.servidorNombreSnapshot ?? '—'],
              ['Referencia histórica', row.referenciaNombreSnapshot ?? '—'],
              ['Observaciones', row.observaciones ?? row.descripcion ?? '—'],
              ['Origen', row.origen],
              ['Motivo de anulación', row.motivoAnulacion ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-text-secondary">{label}</dt>
                <dd className="break-words whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
          <nav className="flex flex-wrap gap-4">
            {row.suscripcion && (
              <Link
                className="text-primary underline"
                href={'/clientes/' + row.suscripcion.cliente.id}
              >
                Cliente: {row.suscripcion.cliente.nombre}
              </Link>
            )}
            {row.suscripcionId && (
              <Link className="text-primary underline" href={'/suscripciones/' + row.suscripcionId}>
                Ver suscripción
              </Link>
            )}
            {row.renovacionId && (
              <Link className="text-primary underline" href={'/renovaciones/' + row.renovacionId}>
                Gestionar cobro o anulación en renovaciones
              </Link>
            )}
          </nav>
          {row.tipo.valor === 'INGRESO' && (
            <p>
              Ingreso bruto de solo lectura. Su cobro y anulación se gestionan mediante la operación
              de servicio; no se duplica ni se modifica desde Finanzas.
            </p>
          )}
          {row.tipo.valor === 'GASTO' &&
            row.origen === 'GASTO_MANUAL' &&
            row.estado.valor === 'CONFIRMADO' && (
              <div className="flex gap-3">
                <Button onClick={() => setAction({ kind: 'editar', row })}>Editar gasto</Button>
                <Button onClick={() => setAction({ kind: 'anular', row })}>Anular gasto</Button>
              </div>
            )}
        </>
      )}
      <section className="space-y-3">
        <h2 className="text-xl">Historial</h2>
        {history.isPending && <p role="status">Cargando historial…</p>}
        {history.isError && (
          <p role="alert">
            {catalogError(history.error)}{' '}
            <Button onClick={() => void history.refetch()}>Reintentar historial</Button>
          </p>
        )}
        {history.data?.data.length === 0 && <p>Sin cambios registrados.</p>}
        {history.data?.data.map((entry) => (
          <article key={entry.id} className="border-hover rounded border p-3">
            <p>
              {entry.accion} · {dateLabel(entry.createdAt)} · {entry.usuario?.nombre ?? 'Sistema'}
            </p>
            <details>
              <summary>Ver cambios</summary>
              <h3>Antes</h3>
              <pre className="overflow-auto text-xs">
                {JSON.stringify(entry.datosAnteriores, null, 2)}
              </pre>
              <h3>Después</h3>
              <pre className="overflow-auto text-xs">
                {JSON.stringify(entry.datosNuevos, null, 2)}
              </pre>
            </details>
          </article>
        ))}
        {history.data && (
          <div className="flex items-center gap-3">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              disabled={page >= history.data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        )}
      </section>
      {action && <ExpenseDialog action={action} onClose={() => setAction(null)} />}
    </div>
  );
}

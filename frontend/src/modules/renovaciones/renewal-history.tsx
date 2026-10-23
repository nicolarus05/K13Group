'use client';
import { useConfiguredPage } from '@/modules/configuracion/preferences';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EstadoBadge } from '@/components/ui/badge';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { type Subscription } from '@/modules/suscripciones/suscripciones.service';
import { renewals, money, type Renewal, type RenewalQuery } from './renovaciones.service';
import { RenewalDialog, type RenewalAction } from './renewal-dialog';

export function RenewalRecord({
  row,
  onAction,
}: {
  row: Renewal;
  onAction: (action: RenewalAction) => void;
}) {
  const dateLabel = useDateLabel();

  const movement = row.movimientos[0];
  const done = row.estado?.valor === 'COMPLETADA';
  return (
    <article className="border-hover space-y-2 rounded border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="text-primary underline" href={'/renovaciones/' + row.id}>
          {row.tipoOperacion === 'ALTA' ? 'Primer pago' : 'Renovación'} ·{' '}
          {row.suscripcion.cliente.nombre}
        </Link>
        <EstadoBadge estado={row.estado?.valor ?? 'SIN_ESTADO'} />
        <EstadoBadge
          estado={movement?.estado.valor ?? (row.metodoPago.esGratuito ? 'GRATIS' : 'SIN_REGISTRO')}
        />
      </div>
      <p>
        {row.productoNombreSnapshot ?? row.suscripcion.producto.nombre} ·{' '}
        {row.tarifaNombreSnapshot ?? 'Sin tarifa histórica'} ·{' '}
        {row.servidorNombreSnapshot ?? 'Sin servidor histórico'}
      </p>
      <p>
        {dateLabel(row.fechaInicio)} — {dateLabel(row.fechaFin)} · {money(row.importe)}
      </p>
      <p>
        Método:{' '}
        {movement?.metodoPagoNombreSnapshot ??
          row.metodoPagoNombreSnapshot ??
          row.metodoPago.nombre}
      </p>
      {movement?.estado.valor === 'PENDIENTE' && (
        <p className="text-warning">
          Cobro pendiente. Previsto:{' '}
          {movement.fechaPrevistaCobro ? dateLabel(movement.fechaPrevistaCobro) : 'No indicado'}. No
          es un ingreso confirmado.
        </p>
      )}
      {movement?.fechaCobro && <p>Cobrado el {dateLabel(movement.fechaCobro)}</p>}
      {row.observaciones && <p>{row.observaciones}</p>}
      {row.motivoAnulacion && <p>Motivo de anulación: {row.motivoAnulacion}</p>}
      <div className="flex flex-wrap gap-2">
        <Link className="text-primary underline" href={'/suscripciones/' + row.suscripcionId}>
          Ver suscripción
        </Link>
        {done && row.origen === 'GESTION_WEB' && movement?.estado.valor === 'PENDIENTE' && (
          <Button onClick={() => onAction({ kind: 'cobrar', renewal: row })}>
            Registrar cobro
          </Button>
        )}
        {done && row.origen === 'GESTION_WEB' && (
          <Button variant="danger" onClick={() => onAction({ kind: 'anular', renewal: row })}>
            Anular operación
          </Button>
        )}
      </div>
    </article>
  );
}
export function RenewalHistory({ filters = {} }: { filters?: RenewalQuery }) {
  const refreshInterval = useRefreshInterval();

  const [page, setPage, pageLimit] = useConfiguredPage();
  const [action, setAction] = useState<RenewalAction | null>(null);
  const query = useQuery({
    queryKey: ['renovaciones', 'historial', filters, page, pageLimit],
    queryFn: () => renewals.list({ ...filters, page, limit: pageLimit }),
    refetchInterval: action ? false : refreshInterval,
  });
  return (
    <section className="space-y-3">
      {query.isPending && <p role="status">Cargando historial…</p>}
      {query.isError && (
        <div role="alert">
          {catalogError(query.error)}{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </div>
      )}
      {query.data && !query.data.data.length && <p>No hay operaciones para estos filtros.</p>}
      {query.data?.data.map((row) => (
        <RenewalRecord key={row.id} row={row} onAction={setAction} />
      ))}
      {query.data && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span>
            Página {page} · {query.data.pagination.total} operaciones
          </span>
          <Button
            variant="secondary"
            disabled={page >= query.data.pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
      {action && <RenewalDialog action={action} onClose={() => setAction(null)} />}
    </section>
  );
}
export function SubscriptionRenewals({ subscription }: { subscription: Subscription }) {
  const [action, setAction] = useState<RenewalAction | null>(null);
  const query = useQuery({
    queryKey: ['renovaciones', 'initial', subscription.id],
    queryFn: () =>
      renewals.list({ suscripcionId: subscription.id, estado: 'COMPLETADA', limit: 1 }),
  });
  const allowed = ['ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA'].includes(subscription.estado.valor);
  return (
    <section className="border-hover space-y-4 rounded border p-4">
      <h2 className="text-lg font-semibold">Renovaciones y cobros</h2>
      {subscription.noRenovar && (
        <p className="text-warning">No renovar: esta suscripción está excluida del seguimiento.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {allowed && !subscription.noRenovar && (
          <Button onClick={() => setAction({ kind: 'renovar', subscription })}>Renovar</Button>
        )}
        {allowed && query.data?.pagination.total === 0 && (
          <Button variant="secondary" onClick={() => setAction({ kind: 'alta', subscription })}>
            Registrar primer pago
          </Button>
        )}
        {!['CANCELADA', 'HISTORICA'].includes(subscription.estado.valor) && (
          <Button
            variant="secondary"
            onClick={() => setAction({ kind: 'preferencia', subscription })}
          >
            {subscription.noRenovar ? 'Permitir renovación' : 'No renovar'}
          </Button>
        )}
      </div>
      {query.isError && (
        <p role="alert">
          No se pudo comprobar el primer pago.{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      )}
      <RenewalHistory filters={{ suscripcionId: subscription.id }} />
      {action && <RenewalDialog action={action} onClose={() => setAction(null)} />}
    </section>
  );
}

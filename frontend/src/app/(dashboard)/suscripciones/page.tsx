'use client';
import { useListQuery } from '@/modules/configuracion/preferences';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EstadoBadge } from '@/components/ui/badge';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import {
  catalogOptions,
  subscriptions,
  subscriptionStates,
  type SubscriptionQuery,
} from '@/modules/suscripciones/suscripciones.service';
import { selectStyle } from '@/modules/suscripciones/subscription-form';
import { clientesService } from '@/modules/clientes/services/clientes.service';

export default function Page() {
  return (
    <Suspense fallback={<p>Cargando suscripciones…</p>}>
      <SubscriptionsPage />
    </Suspense>
  );
}
function SubscriptionsPage() {
  const params = useSearchParams();
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const [query, setQuery] = useListQuery<SubscriptionQuery>({
    page: 1,
    ...(params.get('referenciaId') ? { referenciaId: params.get('referenciaId')! } : {}),
    sort: 'fechaFin',
    order: 'asc',
  });
  const [clientSearch, setClientSearch] = useState('');
  const result = useQuery({
    queryKey: ['suscripciones', query],
    queryFn: () => subscriptions.list(query),
    refetchInterval: refreshInterval,
  });
  const options = useQuery({
    queryKey: ['catalogos', 'filtros-suscripciones'],
    queryFn: async () => ({
      productoId: await catalogOptions('productos'),
      servidorId: await catalogOptions('servidores'),
      referenciaId: await catalogOptions('referencias'),
    }),
  });
  const clients = useQuery({
    queryKey: ['clientes', 'filtro-suscripcion', clientSearch],
    queryFn: () =>
      clientesService.findAll({ search: clientSearch, limit: 25 }).then((r) => r.data.data),
  });
  const filter = (fields: SubscriptionQuery) => setQuery((old) => ({ ...old, ...fields, page: 1 }));
  const p = result.data?.pagination;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap justify-between gap-3">
        <h1 className="text-xl font-semibold">Suscripciones</h1>
        <Link className="text-primary underline" href="/suscripciones/nueva">
          Nueva suscripción
        </Link>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          label="Buscar cliente, teléfono o producto"
          maxLength={150}
          value={query.search ?? ''}
          onChange={(event) => filter({ search: event.target.value })}
        />
        <label>
          Estado
          <select
            aria-label="Estado"
            className={selectStyle}
            value={query.estado ?? ''}
            onChange={(event) => filter({ estado: event.target.value || undefined })}
          >
            <option value="">Todos</option>
            {subscriptionStates.map((state) => (
              <option key={state} value={state}>
                {state.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Orden
          <select
            aria-label="Orden"
            className={selectStyle}
            value={query.sort + ':' + query.order}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(':');
              filter({
                sort: sort as SubscriptionQuery['sort'],
                order: order as SubscriptionQuery['order'],
              });
            }}
          >
            <option value="fechaFin:asc">Próxima renovación primero</option>
            <option value="fechaFin:desc">Vencimiento descendente</option>
            <option value="createdAt:desc">Más recientes</option>
          </select>
        </label>
        {(['productoId', 'servidorId', 'referenciaId'] as const).map((field, index) => (
          <label key={field}>
            {['Producto', 'Servidor', 'Referencia'][index]}
            <select
              aria-label={['Producto', 'Servidor', 'Referencia'][index]}
              className={selectStyle}
              value={query[field] ?? ''}
              onChange={(event) => filter({ [field]: event.target.value || undefined })}
            >
              <option value="">Todos</option>
              {options.data?.[field].map((row) => (
                <option key={row.id} value={row.id}>
                  {row.nombre}
                  {!row.activo || row.deletedAt ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
        <Input
          label="Buscar cliente para filtrar"
          value={clientSearch}
          onChange={(event) => {
            setClientSearch(event.target.value);
            filter({ clienteId: undefined });
          }}
        />
        <label>
          Cliente
          <select
            aria-label="Cliente"
            className={selectStyle}
            value={query.clienteId ?? ''}
            onChange={(event) => filter({ clienteId: event.target.value || undefined })}
          >
            <option value="">Todos</option>
            {clients.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(options.isError || clients.isError) && (
        <p role="alert">
          No se pudieron cargar algunos filtros.{' '}
          <Button
            onClick={() => {
              void options.refetch();
              void clients.refetch();
            }}
          >
            Reintentar filtros
          </Button>
        </p>
      )}
      <Button variant="secondary" onClick={() => void result.refetch()} loading={result.isFetching}>
        Actualizar
      </Button>
      {result.isPending ? (
        <p role="status">Cargando suscripciones…</p>
      ) : result.isError ? (
        <p role="alert">{catalogError(result.error)}</p>
      ) : !result.data.data.length ? (
        <p>No hay suscripciones para estos filtros.</p>
      ) : (
        <div className="space-y-3">
          {result.data.data.map((row) => (
            <article
              key={row.id}
              className="border-hover flex flex-wrap items-center justify-between gap-3 rounded border p-4"
            >
              <div>
                <Link
                  className="text-primary font-medium underline"
                  href={'/suscripciones/' + row.id}
                >
                  {row.cliente.nombre} · {row.producto.nombre}
                </Link>
                <p className="text-text-secondary text-sm">
                  {row.tarifa.nombre} · {row.servidor.nombre} · Renovación:{' '}
                  {dateLabel(row.fechaFin)}
                </p>
                {row.cliente.deletedAt && (
                  <p className="text-xs">Cliente eliminado: registro histórico.</p>
                )}
              </div>
              <EstadoBadge estado={row.estado.valor} />
            </article>
          ))}
        </div>
      )}
      {p && (
        <div className="flex items-center gap-3">
          <span>
            {p.total} registros · Página {p.page} de {Math.max(1, p.totalPages)}
          </span>
          <Button
            variant="secondary"
            disabled={p.page <= 1}
            onClick={() => setQuery((old) => ({ ...old, page: p.page - 1 }))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            disabled={p.page >= p.totalPages}
            onClick={() => setQuery((old) => ({ ...old, page: p.page + 1 }))}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

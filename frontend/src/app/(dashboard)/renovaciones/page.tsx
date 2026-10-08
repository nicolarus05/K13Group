'use client';
import { useConfiguredPage } from '@/modules/configuracion/preferences';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EstadoBadge } from '@/components/ui/badge';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';

import { renewals, money } from '@/modules/renovaciones/renovaciones.service';
import { RenewalHistory } from '@/modules/renovaciones/renewal-history';
import { RenewalDialog, type RenewalAction } from '@/modules/renovaciones/renewal-dialog';

function RenewalsPage() {
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('historial') === '1' ? 'historial' : 'seguimiento');
  const [view, setView] = useState('hoy');
  const [search, setSearch] = useState('');
  const [page, setPage, pageLimit] = useConfiguredPage();
  const [payment, setPayment] = useState('');
  const [state, setState] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState<RenewalAction | null>(null);
  const filters = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(params.get('clienteId') ? { clienteId: params.get('clienteId')! } : {}),
  };
  const queue = useQuery({
    queryKey: ['renovaciones', 'seguimiento', filters, view, page, pageLimit],
    queryFn: () => renewals.queue({ ...filters, vista: view, page, limit: pageLimit }),
    enabled: tab === 'seguimiento',
    refetchInterval: action ? false : refreshInterval,
  });
  const historyFilters = {
    ...filters,
    ...(payment ? { cobro: payment } : {}),
    ...(state ? { estado: state } : {}),
    ...(from ? { desde: from } : {}),
    ...(to ? { hasta: to } : {}),
  };
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Renovaciones</h1>
      <p>
        Renovar amplía el servicio. Registrar un cobro pendiente después no cambia el vencimiento.
      </p>
      <div className="flex gap-2">
        {['seguimiento', 'historial'].map((value) => (
          <Button
            key={value}
            variant={tab === value ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(value);
              setPage(1);
            }}
          >
            {value === 'seguimiento' ? 'Por gestionar' : 'Historial y cobros'}
          </Button>
        ))}
      </div>
      <Input
        label="Buscar cliente"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        maxLength={150}
      />
      {tab === 'seguimiento' ? (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              ['hoy', 'Hoy'],
              ['manana', 'Mañana'],
              ['proximas', 'Próximas'],
              ['vencidas', 'Vencidas'],
              ['no-renovar', 'No renovar'],
              ['todas', 'Todas'],
            ].map(([value, label]) => (
              <Button
                key={value}
                variant={view === value ? 'primary' : 'secondary'}
                onClick={() => {
                  setView(value);
                  setPage(1);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {queue.isPending && <p role="status">Cargando seguimiento…</p>}
          {queue.isError && (
            <div role="alert">
              {catalogError(queue.error)}{' '}
              <Button onClick={() => void queue.refetch()}>Reintentar</Button>
            </div>
          )}
          {queue.data && !queue.data.data.length && <p>No hay suscripciones en esta vista.</p>}
          {queue.data?.data.map((row) => (
            <article key={row.id} className="border-hover space-y-2 rounded border p-4">
              <div className="flex flex-wrap gap-3">
                <Link className="text-primary underline" href={'/suscripciones/' + row.id}>
                  {row.cliente.nombre} · {row.producto.nombre}
                </Link>
                <EstadoBadge estado={row.estado.valor} />
              </div>
              <p>
                {row.servidor.nombre} · Vence el {dateLabel(row.fechaFin)} ·{' '}
                {money(row.tarifa.precio ?? 0)} / año
              </p>
              {row.noRenovar ? (
                <Button onClick={() => setAction({ kind: 'preferencia', subscription: row })}>
                  Permitir renovación
                </Button>
              ) : (
                <Button onClick={() => setAction({ kind: 'renovar', subscription: row })}>
                  Renovar
                </Button>
              )}
            </article>
          ))}
          {queue.data && (
            <div className="flex items-center gap-3">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span>
                Página {page} · {queue.data.pagination.total} suscripciones
              </span>
              <Button
                variant="secondary"
                disabled={page >= queue.data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <label>
              Cobro
              <select
                aria-label="Filtrar cobro"
                className="border-hover bg-background block w-full rounded border p-2"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="CONFIRMADO">Confirmado</option>
                <option value="GRATIS">Gratis</option>
              </select>
            </label>
            <label>
              Operación
              <select
                aria-label="Filtrar operación"
                className="border-hover bg-background block w-full rounded border p-2"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="COMPLETADA">Completada</option>
                <option value="ANULADA">Anulada</option>
              </select>
            </label>
            <Input
              label="Desde"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <RenewalHistory key={JSON.stringify(historyFilters)} filters={historyFilters} />
        </>
      )}
      {action && <RenewalDialog action={action} onClose={() => setAction(null)} />}
    </div>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p>Cargando renovaciones…</p>}>
      <RenewalsPage />
    </Suspense>
  );
}

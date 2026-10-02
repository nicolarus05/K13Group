'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EstadoBadge } from '@/components/ui/badge';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import {
  dateLabel,
  subscriptions,
  type Subscription,
} from '@/modules/suscripciones/suscripciones.service';
import { SubscriptionForm } from '@/modules/suscripciones/subscription-form';
import { SubscriptionRenewals } from '@/modules/renovaciones/renewal-history';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const cache = useQueryClient();
  const [edit, setEdit] = useState<Subscription | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{
    kind: 'suspender' | 'reactivar' | 'cancelar';
    record: Subscription;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const detail = useQuery({
    queryKey: ['suscripciones', id],
    queryFn: () => subscriptions.get(id),
    enabled: !edit && !action,
    refetchInterval: edit || action ? false : 60000,
  });
  const history = useQuery({
    queryKey: ['suscripciones', id, 'historial', page],
    queryFn: () => subscriptions.history(id, page),
    enabled: Boolean(detail.data) && !edit && !action,
    refetchInterval: edit || action ? false : 60000,
  });
  // Una respuesta tardía no debe sustituir la copia sobre la que el usuario trabaja.
  const row = edit ?? action?.record ?? detail.data;
  async function transition(event: FormEvent) {
    event.preventDefault();
    if (!row || !action || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await subscriptions.action(id, action.kind, action.record.version, reason);
      setAction(null);
      setReason('');
      setPage(1);
      setNotice('Estado actualizado. Fechas e historial conservados.');
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['suscripciones'] }),
        cache.invalidateQueries({ queryKey: ['clientes'] }),
        cache.invalidateQueries({ queryKey: ['dashboard'] }),
        cache.invalidateQueries({ queryKey: ['estadisticas'] }),
        cache.invalidateQueries({ queryKey: ['recordatorios'] }),
      ]);
    } catch (error) {
      setError(catalogError(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  if (detail.isPending && !row) return <p role="status">Cargando suscripción…</p>;
  if (!row)
    return (
      <div>
        <p role="alert">{catalogError(detail.error)}</p>
        <Button onClick={() => void detail.refetch()}>Reintentar</Button>
        <Link href="/suscripciones">Volver</Link>
      </div>
    );
  const ended = row.estado.valor === 'CANCELADA';
  return (
    <div className="space-y-5">
      <Link href="/suscripciones" className="text-primary underline">
        Volver a suscripciones
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          {row.cliente.nombre} · {row.producto.nombre}
        </h1>
        <EstadoBadge estado={row.estado.valor} />
      </header>
      {!edit && !action && <SubscriptionRenewals subscription={row} />}
      {edit ? (
        <>
          <Button variant="secondary" onClick={() => setEdit(null)}>
            Cerrar edición
          </Button>
          <SubscriptionForm
            key={edit.id}
            item={edit}
            onCancel={() => setEdit(null)}
            onSaved={() => {
              setEdit(null);
              setNotice('Suscripción actualizada.');
            }}
          />
        </>
      ) : (
        <>
          <dl className="border-hover grid gap-4 rounded border p-4 sm:grid-cols-2">
            <div>
              <dt>Cliente</dt>
              <dd>
                {row.cliente.deletedAt ? (
                  row.cliente.nombre + ' (eliminado)'
                ) : (
                  <Link href={'/clientes/' + row.clienteId} className="text-primary underline">
                    {row.cliente.nombre}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt>Tarifa actual</dt>
              <dd>
                {row.tarifa.nombre} ·{' '}
                {Number(row.tarifa.precio).toLocaleString('es-ES', {
                  style: 'currency',
                  currency: 'EUR',
                })}
              </dd>
            </div>
            <div>
              <dt>Servidor</dt>
              <dd>{row.servidor.nombre}</dd>
            </div>
            <div>
              <dt>Referencia</dt>
              <dd>{row.referencia?.nombre ?? 'Sin referencia'}</dd>
            </div>
            <div>
              <dt>Inicio del periodo</dt>
              <dd>{dateLabel(row.fechaInicio)}</dd>
            </div>
            <div>
              <dt>Próxima renovación</dt>
              <dd>{dateLabel(row.fechaFin)}</dd>
            </div>
            <div>
              <dt>Dispositivo</dt>
              <dd>{row.tipoDispositivo || 'No indicado'}</dd>
            </div>
          </dl>
          {[
            row.producto,
            row.tarifa,
            row.servidor,
            ...(row.referencia ? [row.referencia] : []),
          ].some((item) => !item.activo || item.deletedAt) && (
            <p className="text-warning">
              Hay catálogos inactivos vinculados. Se mantienen por historial; para cambiarlos debes
              elegir opciones activas.
            </p>
          )}
          {!ended && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saving || Boolean(action)}
                onClick={() => {
                  setEdit(row);
                  setError('');
                }}
              >
                Editar
              </Button>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setAction({
                    kind: row.estado.valor === 'SUSPENDIDA' ? 'reactivar' : 'suspender',
                    record: row,
                  });
                  setError('');
                  setReason('');
                }}
              >
                {row.estado.valor === 'SUSPENDIDA' ? 'Reactivar' : 'Suspender'}
              </Button>
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => {
                  setAction({ kind: 'cancelar', record: row });
                  setError('');
                  setReason('');
                }}
              >
                Cancelar suscripción
              </Button>
            </div>
          )}
          {ended && (
            <p>Cancelada definitivamente. Para una nueva contratación, crea otra suscripción.</p>
          )}
          {action && (
            <form
              onSubmit={(event) => void transition(event)}
              className="border-hover max-w-xl space-y-3 rounded border p-4"
            >
              <p>
                {action.kind === 'cancelar'
                  ? 'La cancelación es definitiva y no elimina el historial.'
                  : action.kind === 'reactivar'
                    ? 'Se recalculará el estado según el vencimiento, sin ampliar las fechas.'
                    : 'La suspensión es manual y conserva las fechas.'}
              </p>
              <Input
                label="Motivo"
                required
                minLength={3}
                maxLength={1000}
                disabled={saving}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button type="submit" loading={saving}>
                Confirmar {action.kind}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => setAction(null)}
              >
                Volver sin cambios
              </Button>
            </form>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}{' '}
          <Button
            onClick={() => {
              setAction(null);
              void detail.refetch();
            }}
          >
            Recargar datos
          </Button>
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Historial de cambios</h2>
        {history.isPending ? (
          <p>Cargando historial…</p>
        ) : history.isError ? (
          <p role="alert">
            {catalogError(history.error)}{' '}
            <Button onClick={() => void history.refetch()}>Reintentar historial</Button>
          </p>
        ) : history.data.data.length ? (
          history.data.data.map((entry) => (
            <article key={entry.id} className="border-hover rounded border p-3">
              <p>
                {entry.accion.replaceAll('_', ' ')} · {entry.usuario?.nombre ?? 'Sistema'} ·{' '}
                {new Date(entry.createdAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}
              </p>
              {entry.datosNuevos?.motivo && <p className="text-sm">{entry.datosNuevos.motivo}</p>}
              <details className="mt-2 text-sm">
                <summary>Ver datos anteriores y posteriores</summary>
                <pre className="overflow-auto break-all whitespace-pre-wrap">
                  {JSON.stringify(
                    { antes: entry.datosAnteriores, despues: entry.datosNuevos },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))
        ) : (
          <p>No hay cambios registrados.</p>
        )}
        {history.data && (
          <div className="flex gap-3">
            <span>
              Página {page} de {Math.max(1, history.data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Historial anterior
            </Button>
            <Button
              variant="secondary"
              disabled={page >= history.data.pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Historial siguiente
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

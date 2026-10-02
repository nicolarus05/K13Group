'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { clientesService } from '@/modules/clientes/services/clientes.service';
import {
  annualPreview,
  catalogOptions,
  subscriptions,
  todayMadrid,
  type Subscription,
  type SubscriptionInput,
} from './suscripciones.service';
import type { CatalogRecord } from '@/modules/catalogos/types/catalogos.types';

export const selectStyle =
  'w-full rounded-input border border-hover bg-background px-3 py-2 text-sm';
export function SubscriptionForm({
  item,
  initialClientId,
  onSaved,
  onCancel,
}: {
  item?: Subscription;
  initialClientId?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const cache = useQueryClient();
  const [input, setInput] = useState<SubscriptionInput>({
    clienteId: item?.clienteId ?? initialClientId ?? '',
    productoId: item?.productoId ?? '',
    tarifaId: item?.tarifaId ?? '',
    servidorId: item?.servidorId ?? '',
    referenciaId: item?.referenciaId ?? null,
    fechaInicio: item?.fechaInicio.slice(0, 10) ?? todayMadrid(),
    tipoDispositivo: item?.tipoDispositivo ?? '',
  });
  const [clientSearch, setClientSearch] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  // Una renovación anticipada ya confirmada puede tener un inicio futuro.
  // Se conserva ese periodo; las altas y correcciones siguen limitadas a hoy.
  const futureRenewal = Boolean(item && item.fechaInicio.slice(0, 10) > todayMadrid());
  const options = useQuery({
    queryKey: ['catalogos', 'suscripciones-options'],
    queryFn: async () => {
      const [products, rates, servers, references] = await Promise.all(
        ['productos', 'tarifas', 'servidores', 'referencias'].map((kind) =>
          catalogOptions(kind as 'productos' | 'tarifas' | 'servidores' | 'referencias'),
        ),
      );
      return { products, rates, servers, references };
    },
  });
  const clients = useQuery({
    queryKey: ['clientes', 'selector-suscripcion', clientSearch],
    queryFn: () =>
      clientesService.findAll({ search: clientSearch, limit: 25 }).then((r) => r.data.data),
    enabled: !item,
  });
  const chosenClient = useQuery({
    queryKey: ['clientes', 'seleccionado', input.clienteId],
    queryFn: () => clientesService.findOne(input.clienteId).then((r) => r.data.data),
    enabled: !item && Boolean(input.clienteId),
  });
  const available = (rows: CatalogRecord[] = [], current?: string | null) =>
    rows.filter((row) => (row.activo && !row.deletedAt) || row.id === current);
  const products = available(options.data?.products, item?.productoId);
  const rates = available(options.data?.rates, item?.tarifaId).filter(
    (row) =>
      row.productoId === input.productoId &&
      ((options.data?.products.find((product) => product.id === row.productoId)?.activo &&
        !options.data?.products.find((product) => product.id === row.productoId)?.deletedAt) ||
        row.id === item?.tarifaId),
  );
  const update = <K extends keyof SubscriptionInput>(key: K, value: SubscriptionInput[K]) =>
    setInput((old) => ({ ...old, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (item && input.fechaInicio !== item.fechaInicio.slice(0, 10) && reason.trim().length < 3) {
      setError('Explica el motivo de la corrección de fecha.');
      return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      let saved: Subscription;
      if (item) {
        const changes = {
          tarifaId: input.tarifaId,
          servidorId: input.servidorId,
          referenciaId: input.referenciaId,
          fechaInicio: input.fechaInicio,
          tipoDispositivo: input.tipoDispositivo,
        };
        saved = await subscriptions.update(item.id, changes, item.version, reason);
      } else {
        const fingerprint = JSON.stringify(input);
        if (request.current?.fingerprint !== fingerprint)
          request.current = { fingerprint, id: crypto.randomUUID() };
        saved = await subscriptions.create(input, request.current.id);
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['suscripciones'] }),
        cache.invalidateQueries({ queryKey: ['clientes'] }),
        cache.invalidateQueries({ queryKey: ['dashboard'] }),
        cache.invalidateQueries({ queryKey: ['estadisticas'] }),
        cache.invalidateQueries({ queryKey: ['recordatorios'] }),
      ]);
      onSaved?.();
      router.push('/suscripciones/' + saved.id);
    } catch (error) {
      setError(catalogError(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const select = (
    label: string,
    value: string,
    rows: CatalogRecord[],
    change: (value: string) => void,
    required = true,
    disabled = false,
  ) => (
    <label className="block space-y-1 text-sm">
      {label}
      <select
        aria-label={label}
        className={selectStyle}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">{required ? 'Selecciona una opción' : 'Sin referencia'}</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.nombre}
            {!row.activo || row.deletedAt ? ' (inactivo)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-2xl space-y-4">
      <p className="text-text-secondary text-sm">
        Periodo anual. Esta operación no cobra ni registra una renovación.
      </p>
      {options.isPending && <p role="status">Cargando catálogos…</p>}
      {options.isError && (
        <p role="alert">
          {catalogError(options.error)}{' '}
          <Button type="button" onClick={() => void options.refetch()}>
            Reintentar
          </Button>
        </p>
      )}
      {(clients.isError || chosenClient.isError) && (
        <p role="alert">
          No se pudieron cargar los clientes.{' '}
          <Button
            type="button"
            onClick={() => {
              void clients.refetch();
              if (input.clienteId) void chosenClient.refetch();
            }}
          >
            Reintentar clientes
          </Button>
        </p>
      )}
      <fieldset disabled={saving || !options.data} className="space-y-4">
        {item ? (
          <p>Cliente: {item.cliente.nombre}</p>
        ) : (
          <>
            <Input
              label="Buscar cliente por nombre o teléfono"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
            />
            <label className="block space-y-1 text-sm">
              Cliente
              <select
                aria-label="Cliente"
                className={selectStyle}
                required
                value={input.clienteId}
                onChange={(event) => update('clienteId', event.target.value)}
              >
                <option value="">Selecciona un cliente activo</option>
                {chosenClient.data &&
                  !clients.data?.some((client) => client.id === chosenClient.data.id) && (
                    <option value={chosenClient.data.id}>{chosenClient.data.nombre}</option>
                  )}
                {clients.data
                  ?.filter(
                    (client) => client.estado.valor === 'ACTIVO' || client.id === input.clienteId,
                  )
                  .map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.nombre}
                      {client.telefono ? ' · ' + client.telefono : ''}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-text-secondary text-xs">
              Se muestran hasta 25 coincidencias. Busca para encontrar otros clientes.
            </p>
          </>
        )}
        {select(
          'Producto',
          input.productoId,
          products,
          (value) => setInput((old) => ({ ...old, productoId: value, tarifaId: '' })),
          true,
          Boolean(item),
        )}
        {select('Tarifa anual', input.tarifaId, rates, (value) => update('tarifaId', value))}
        {select(
          'Servidor',
          input.servidorId,
          available(options.data?.servers, item?.servidorId),
          (value) => update('servidorId', value),
        )}
        {select(
          'Referencia',
          input.referenciaId ?? '',
          available(options.data?.references, item?.referenciaId),
          (value) => update('referenciaId', value || null),
          false,
        )}
        <Input
          label="Fecha de inicio"
          type="date"
          required
          min="1000-01-01"
          max={futureRenewal ? undefined : todayMadrid()}
          readOnly={futureRenewal}
          value={input.fechaInicio}
          onChange={(event) => update('fechaInicio', event.target.value)}
        />
        {futureRenewal && (
          <p className="text-text-secondary text-sm">
            Periodo de renovación anticipada. Las fechas se gestionan desde renovaciones.
          </p>
        )}
        <p className="text-sm">Próxima renovación: {annualPreview(input.fechaInicio)}</p>
        {item && input.fechaInicio !== item.fechaInicio.slice(0, 10) && (
          <>
            <p className="text-warning text-sm">
              Solo corrige un error de captura. No uses este cambio para renovar. Si ya existen
              renovaciones, la corrección se rechazará.
            </p>
            <Input
              label="Motivo de la corrección"
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </>
        )}
        <Input
          label="Tipo de dispositivo (opcional)"
          maxLength={80}
          value={input.tipoDispositivo}
          onChange={(event) => update('tipoDispositivo', event.target.value)}
        />
      </fieldset>
      {error && (
        <p role="alert" className="text-danger">
          {error}{' '}
          {item && (
            <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
              Recargar datos
            </Button>
          )}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!options.data} loading={saving}>
          {item ? 'Guardar cambios' : 'Crear suscripción'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={() =>
            onCancel
              ? onCancel()
              : router.push(item ? '/suscripciones/' + item.id : '/suscripciones')
          }
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

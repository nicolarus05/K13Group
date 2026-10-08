'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import type { CatalogRecord } from '@/modules/catalogos/types/catalogos.types';
export function ReferenceSummary({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['catalogos', 'referencias', id, 'resumen'],
    queryFn: () =>
      api
        .get<{ data: { clientes: number; criterio: string } }>(`/referencias/${id}/resumen`)
        .then((r) => r.data.data),
  });
  return (
    <div className="space-y-1 text-sm">
      <p>
        {query.isError
          ? 'No se pudo cargar la relación de clientes.'
          : query.data
            ? `${query.data.clientes} clientes únicos relacionados actualmente`
            : 'Cargando clientes relacionados…'}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className="text-primary underline" href={`/suscripciones?referenciaId=${id}`}>
          Ver suscripciones y clientes
        </Link>
        <Link className="text-primary underline" href={`/estadisticas?referenciaId=${id}`}>
          Ingresos del mes actual
        </Link>
      </div>
      <p className="text-text-secondary">
        El informe usa la atribución histórica de los cobros; permite cambiar el periodo.
      </p>
    </div>
  );
}
type Order = { version: number; data: CatalogRecord[] };
export function PaymentOrder() {
  const [open, setOpen] = useState(false);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['catalogos', 'metodos-pago', 'orden'],
    enabled: open,
    queryFn: () => api.get<{ data: Order }>('/metodos-pago/orden').then((r) => r.data.data),
  });
  const value = draft ?? query.data;
  function move(index: number, direction: number) {
    if (!value) return;
    const rows = [...value.data];
    [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
    setDraft({ ...value, data: rows });
  }
  async function save() {
    if (!draft) return;
    setPending(true);
    setError('');
    try {
      await api.put('/metodos-pago/orden', {
        version: draft.version,
        ids: draft.data.map((r) => r.id),
        motivo: reason,
      });
      setDraft(null);
      setReason('');
      await cache.invalidateQueries({ queryKey: ['catalogos'] });
    } catch (e) {
      setError(catalogError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <details
      className="border-hover rounded border p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Orden de los métodos de pago en los formularios</summary>
      {query.isError && (
        <p role="alert">
          No se pudo cargar el orden.{' '}
          <Button onClick={() => void query.refetch()}>Reintentar</Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {value && (
        <>
          <ol className="my-3 space-y-2">
            {value.data.map((row, i) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.nombre}
                  {!row.activo || row.deletedAt ? ' (inactivo)' : ''}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Subir ${row.nombre}`}
                    disabled={i === 0 || pending}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Bajar ${row.nombre}`}
                    disabled={i === value.data.length - 1 || pending}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <Input
            label="Motivo del nuevo orden"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex gap-3">
            <Button
              loading={pending}
              disabled={!draft || reason.trim().length < 3}
              onClick={() => void save()}
            >
              Guardar orden
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setDraft(null);
                setError('');
                void query.refetch();
              }}
            >
              Descartar y recargar orden
            </Button>
          </div>
        </>
      )}
    </details>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoBadge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/loader';
import { ClienteFormModal } from '@/modules/clientes/components/cliente-form-modal';
import { useCliente, useUpdateCliente } from '@/modules/clientes/hooks/use-clientes';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { useToast } from '@/components/ui/toast';
import type { ClienteFormData } from '@/modules/clientes/schemas/cliente.schema';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const { data: cliente, isLoading, isError, error: loadError, refetch } = useCliente(id);
  const updateMutation = useUpdateCliente(id);

  if (isLoading) return <PageLoader />;
  if (isError || !cliente)
    return (
      <div className="space-y-4">
        <h1>Ficha de cliente</h1>
        <p role="alert">No se pudo cargar el cliente. {isError && catalogError(loadError)}</p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Reintentar cliente
        </Button>
        <Link className="text-primary block underline" href="/clientes">
          Volver a clientes
        </Link>
      </div>
    );

  async function handleUpdate(data: ClienteFormData) {
    try {
      await updateMutation.mutateAsync(data);
      success('Cliente actualizado correctamente.');
      setEditOpen(false);
    } catch {
      error('Error al actualizar el cliente.');
    }
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          aria-label="Volver"
          onClick={() => router.back()}
          className="text-text-secondary hover:bg-hover rounded p-1.5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-text-main min-w-0 flex-1 text-xl font-semibold break-words">
          {cliente.nombre}
        </h1>
        <EstadoBadge estado={cliente.estado.valor} />
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
      </div>

      {/* Datos del cliente */}
      <Card>
        <CardHeader>
          <CardTitle>Información</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Dato label="Nombre" value={cliente.nombre} />
            <Dato label="Teléfono" value={cliente.telefono} />
            <Dato label="Email" value={cliente.email} />
            <Dato
              label="Alta"
              value={format(new Date(cliente.createdAt), 'dd MMM yyyy', { locale: es })}
            />
            <Dato
              label="Observaciones"
              value={cliente.observaciones}
              className="col-span-2 sm:col-span-3"
            />
          </dl>
        </CardContent>
      </Card>

      {/* Suscripciones e historial del cliente */}
      <Link
        href={'/renovaciones?historial=1&clienteId=' + cliente.id}
        className="text-primary underline"
      >
        Ver renovaciones y cobros del cliente
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Suscripciones</CardTitle>
          <Link
            className="text-primary underline"
            href={'/suscripciones/nueva?clienteId=' + cliente.id}
          >
            Nueva suscripción
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {!cliente.suscripciones?.length && <p>Este cliente todavía no tiene suscripciones.</p>}
            {cliente.suscripciones?.map((s) => (
              <div
                key={s.id}
                className="rounded-input border-hover flex flex-wrap items-center justify-between gap-3 border p-3 text-sm"
              >
                <Link
                  href={'/suscripciones/' + s.id}
                  className="text-primary min-w-0 font-medium break-words underline"
                >
                  {s.producto.nombre}
                </Link>
                <div className="text-text-secondary flex min-w-0 flex-wrap items-center gap-3 break-words">
                  <span className="max-w-full min-w-0 break-words">{s.tarifa?.nombre}</span>
                  <span className="max-w-full min-w-0 break-words">{s.servidor?.nombre}</span>
                  <EstadoBadge estado={s.estado.valor} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ClienteFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate}
        cliente={cliente}
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}

function Dato({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={['min-w-0 break-words', className].filter(Boolean).join(' ')}>
      <dt className="text-text-secondary text-xs">{label}</dt>
      <dd className="text-text-main mt-0.5">{value ?? '—'}</dd>
    </div>
  );
}

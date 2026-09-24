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
import { useToast } from '@/components/ui/toast';
import type { ClienteFormData } from '@/modules/clientes/schemas/cliente.schema';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const { data: cliente, isLoading } = useCliente(id);
  const updateMutation = useUpdateCliente(id);

  if (isLoading) return <PageLoader />;
  if (!cliente) return null;

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
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="rounded p-1.5 text-text-secondary hover:bg-hover"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-text-main">{cliente.nombre}</h1>
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
                className="flex items-center justify-between rounded border border-hover p-3 text-sm"
              >
                <Link
                  href={'/suscripciones/' + s.id}
                  className="font-medium text-primary underline"
                >
                  {s.producto.nombre}
                </Link>
                <div className="flex items-center gap-4 text-text-secondary">
                  <span>{s.tarifa?.nombre}</span>
                  <span>{s.servidor?.nombre}</span>
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
    <div className={className}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="mt-0.5 text-text-main">{value ?? '—'}</dd>
    </div>
  );
}

'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  clienteSchema,
  type ClienteFormData,
  type ClienteFormInput,
} from '../schemas/cliente.schema';
import type { Cliente } from '../types/clientes.types';

interface ClienteFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ClienteFormData) => void | Promise<void>;
  cliente?: Cliente;
  isLoading?: boolean;
  error?: string;
}

export function ClienteFormModal({
  open,
  onClose,
  onSubmit,
  cliente,
  isLoading,
  error,
}: ClienteFormModalProps) {
  const isEditing = !!cliente;
  const submitting = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClienteFormInput, unknown, ClienteFormData>({ resolver: zodResolver(clienteSchema) });
  const busy = isLoading || isSubmitting;

  const handleClose = () => {
    if (!submitting.current && !isLoading) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || isLoading) return;
    // Mutation notifications render later than the request can start.
    // Keep dismissal and repeated submits blocked from this event onward.
    submitting.current = true;
    try {
      await handleSubmit(onSubmit)(event);
    } finally {
      submitting.current = false;
    }
  };

  // Precarga en modo edición
  useEffect(() => {
    if (open) {
      reset(
        cliente
          ? {
              nombre: cliente.nombre,
              telefono: cliente.telefono ?? '',
              email: cliente.email ?? '',
              observaciones: cliente.observaciones ?? '',
            }
          : {},
      );
    }
  }, [open, cliente, reset]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEditing ? 'Editar cliente' : 'Nuevo cliente'}
      size="md"
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <p role="alert" className="text-red-500">
            {error}
          </p>
        )}
        <Input
          label="Nombre *"
          error={errors.nombre?.message}
          disabled={busy}
          {...register('nombre')}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Teléfono"
            type="tel"
            error={errors.telefono?.message}
            disabled={busy}
            {...register('telefono')}
          />
          <Input
            label="Email"
            type="email"
            error={errors.email?.message}
            disabled={busy}
            {...register('email')}
          />
        </div>
        <Input
          label="Observaciones"
          error={errors.observaciones?.message}
          disabled={busy}
          {...register('observaciones')}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            {isEditing ? 'Guardar cambios' : 'Crear cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

'use client';

import { useEffect } from 'react';
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
  onSubmit: (data: ClienteFormData) => void;
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
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClienteFormInput, unknown, ClienteFormData>({ resolver: zodResolver(clienteSchema) });

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
      onClose={onClose}
      title={isEditing ? 'Editar cliente' : 'Nuevo cliente'}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && (
          <p role="alert" className="text-red-500">
            {error}
          </p>
        )}
        <Input
          label="Nombre *"
          error={errors.nombre?.message}
          disabled={isLoading}
          {...register('nombre')}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Teléfono"
            type="tel"
            error={errors.telefono?.message}
            disabled={isLoading}
            {...register('telefono')}
          />
          <Input
            label="Email"
            type="email"
            error={errors.email?.message}
            disabled={isLoading}
            {...register('email')}
          />
        </div>
        <Input
          label="Observaciones"
          error={errors.observaciones?.message}
          disabled={isLoading}
          {...register('observaciones')}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button type="submit" loading={isLoading}>
            {isEditing ? 'Guardar cambios' : 'Crear cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

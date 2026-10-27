import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { clientesService } from '../services/clientes.service';
import type { ClienteQuery } from '../types/clientes.types';
import type { ClienteFormData } from '../schemas/cliente.schema';

export const CLIENTES_KEY = ['clientes'] as const;

// Estos módulos incluyen el nombre y el estado actual del cliente en sus respuestas.
const invalidateClientViews = (cache: QueryClient) =>
  Promise.all(
    ['clientes', 'suscripciones', 'renovaciones', 'finanzas'].map((key) =>
      cache.invalidateQueries({ queryKey: [key] }),
    ),
  );

export function useClientes(query?: ClienteQuery) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, query],
    queryFn: () => clientesService.findAll(query).then((r) => r.data),
  });
}

export function useCliente(id: string) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, id],
    queryFn: () => clientesService.findOne(id).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ClienteFormData) => clientesService.create(data).then((r) => r.data.data),
    onSuccess: () => invalidateClientViews(qc),
  });
}

export function useUpdateCliente(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ClienteFormData>) =>
      clientesService.update(id, data).then((r) => r.data.data),
    onSuccess: () => invalidateClientViews(qc),
  });
}

export function useDeleteCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientesService.remove(id),
    onSuccess: () => invalidateClientViews(qc),
  });
}

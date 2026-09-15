import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importacionesService } from '../services/importaciones.service';

export function usePreviewImportacion() {
  return useMutation({ mutationFn: (file: File) => importacionesService.preview(file) });
}

export function useConfirmImportacion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permitirAdvertencias }: { id: string; permitirAdvertencias: boolean }) =>
      importacionesService.confirm(id, permitirAdvertencias),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['importacion', variables.id] }),
  });
}

export function useImportacionRows(id: string | undefined, params?: { page?: number; limit?: number; estado?: string }) {
  return useQuery({
    queryKey: ['importacion', id, 'filas', params],
    queryFn: () => importacionesService.rows(id!, params).then((response) => response.data),
    enabled: Boolean(id),
  });
}

export function useImportacionCatalogs(id: string | undefined) {
  return useQuery({
    queryKey: ['importacion', id, 'catalogos'],
    queryFn: () => importacionesService.catalogs(id!).then((response) => response.data.data),
    enabled: Boolean(id),
  });
}

export function usePendingImportacionValues(id: string | undefined) {
  return useQuery({
    queryKey: ['importacion', id, 'valores-pendientes'],
    queryFn: () => importacionesService.pendingValues(id!).then((response) => response.data.data),
    enabled: Boolean(id),
  });
}

export function useReviewImportacionRow(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) =>
      importacionesService.reviewRow(id, rowId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['importacion', id] });
    },
  });
}

export function useReconcileImportacion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmarFinanzas }: { id: string; confirmarFinanzas: boolean }) =>
      importacionesService.reconcile(id, confirmarFinanzas).then((response) => response.data.data),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['importacion', variables.id] }),
  });
}

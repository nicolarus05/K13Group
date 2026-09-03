import { useMutation } from '@tanstack/react-query';
import { importacionesService } from '../services/importaciones.service';

export function usePreviewImportacion() {
  return useMutation({ mutationFn: (file: File) => importacionesService.preview(file) });
}

export function useConfirmImportacion() {
  return useMutation({
    mutationFn: ({ id, permitirAdvertencias }: { id: string; permitirAdvertencias: boolean }) =>
      importacionesService.confirm(id, permitirAdvertencias),
  });
}

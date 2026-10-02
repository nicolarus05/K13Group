'use client';
import { useEffect } from 'react';

// Solo una respuesta terminada de la página actual puede corregir la navegación.
export function usePageBounds(
  page: number,
  setPage: (page: number) => void,
  pagination: { page: number; totalPages: number } | undefined,
  settled: boolean,
) {
  const lastPage = Math.max(1, pagination?.totalPages ?? 1);
  const adjusting = settled && pagination?.page === page && page > lastPage;
  useEffect(() => {
    if (adjusting) setPage(lastPage);
  }, [adjusting, lastPage, setPage]);
  return adjusting;
}

'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { catalogosService } from '@/modules/catalogos/services/catalogos.service';
import type { CatalogKind } from '@/modules/catalogos/types/catalogos.types';
export function CatalogFilter({
  kind,
  title,
  value,
  onChange,
}: {
  kind: CatalogKind;
  title: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const list = useQuery({
    // El prefijo compartido recibe la invalidación de altas, ediciones y estados
    // de Catálogos; el resto de la clave mantiene separadas estas opciones.
    queryKey: ['catalogos', kind, 'estadisticas-opciones', search, page],
    queryFn: () => catalogosService.list(kind, { search, page, limit: 25, estado: 'todos' }),
  });
  return (
    <fieldset className="stats-catalog">
      <legend>{title}</legend>
      <input
        aria-label={'Buscar opciones de ' + title}
        placeholder="Buscar en catálogo…"
        value={search}
        maxLength={150}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {value && !list.data?.data.some((r) => r.id === value) && (
          <option value={value}>Selección actual</option>
        )}
        {list.data?.data.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nombre}
            {r.activo ? '' : ' (inactivo)'}
          </option>
        ))}
      </select>
      {list.isPending && <small>Cargando opciones…</small>}
      {list.isError && (
        <button type="button" onClick={() => void list.refetch()}>
          Reintentar opciones
        </button>
      )}
      <div>
        <button
          type="button"
          aria-label={'Opciones anteriores de ' + title}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          ‹
        </button>
        <small>Opciones · {page}</small>
        <button
          type="button"
          aria-label={'Más opciones de ' + title}
          disabled={!list.data || page >= list.data.pagination.totalPages}
          onClick={() => setPage(page + 1)}
        >
          ›
        </button>
      </div>
    </fieldset>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EstadoBadge } from '@/components/ui/badge';
import { ConfirmModal } from '@/components/ui/modal';
import { Table, type Column } from '@/components/common/table';
import { Pagination } from '@/components/common/table';
import { ClienteFormModal } from '@/modules/clientes/components/cliente-form-modal';
import {
  useClientes,
  useCreateCliente,
  useUpdateCliente,
  useDeleteCliente,
} from '@/modules/clientes/hooks/use-clientes';
import { useToast } from '@/components/ui/toast';
import type { Cliente } from '@/modules/clientes/types/clientes.types';
import type { ClienteFormData } from '@/modules/clientes/schemas/cliente.schema';

export default function ClientesPage() {
  const router = useRouter();
  const { success, error } = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useClientes({ page, limit: 25, search: search || undefined });
  const createMutation = useCreateCliente();
  const updateMutation = useUpdateCliente(editCliente?.id ?? '');
  const deleteMutation = useDeleteCliente();

  const columns: Column<Cliente>[] = [
    { header: 'Nombre', accessor: 'nombre' },
    { header: 'Teléfono', accessor: (r) => r.telefono ?? '—' },
    { header: 'Email', accessor: (r) => r.email ?? '—' },
    {
      header: 'Estado',
      accessor: (r) => <EstadoBadge estado={r.estado.valor} />,
    },
    {
      header: '',
      accessor: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => { e.stopPropagation(); setEditCliente(r); setFormOpen(true); }}
          >
            Editar
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }}
          >
            Eliminar
          </Button>
        </div>
      ),
      className: 'w-40',
    },
  ];

  async function handleSubmit(formData: ClienteFormData) {
    try {
      if (editCliente) {
        await updateMutation.mutateAsync(formData);
        success('Cliente actualizado correctamente.');
      } else {
        await createMutation.mutateAsync(formData);
        success('Cliente creado correctamente.');
      }
      setFormOpen(false);
      setEditCliente(undefined);
    } catch {
      error('Error al guardar el cliente.');
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      success('Cliente eliminado correctamente.');
    } catch {
      error('Error al eliminar el cliente.');
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-main">Clientes</h1>
        <Button onClick={() => { setEditCliente(undefined); setFormOpen(true); }}>
          <UserPlus className="h-4 w-4" />
          Nuevo cliente
        </Button>
      </div>

      {/* Buscador */}
      <div className="max-w-sm">
        <Input
          placeholder="Buscar por nombre, teléfono o email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Tabla */}
      <div className="rounded-card bg-panel">
        <Table
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          onRowClick={(r) => router.push(`/clientes/${r.id}`)}
          emptyTitle="No hay clientes"
          emptyDescription="Crea el primer cliente pulsando el botón superior."
        />
        {data && data.pagination.totalPages > 1 && (
          <div className="border-t border-hover px-4">
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              total={data.pagination.total}
              limit={data.pagination.limit}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Modal crear / editar */}
      <ClienteFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditCliente(undefined); }}
        onSubmit={handleSubmit}
        cliente={editCliente}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* Modal confirmar borrado */}
      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="¿Eliminar cliente?"
        description="Esta acción marcará el cliente como eliminado. Su historial se conservará."
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

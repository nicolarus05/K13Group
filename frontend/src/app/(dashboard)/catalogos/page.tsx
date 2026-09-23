'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { catalogError, catalogosService } from '@/modules/catalogos/services/catalogos.service';
import type {
  CatalogKind,
  CatalogPayload,
  CatalogQuery,
  CatalogRecord,
} from '@/modules/catalogos/types/catalogos.types';

const tabs: { kind: CatalogKind; label: string }[] = [
  { kind: 'productos', label: 'Productos' },
  { kind: 'tarifas', label: 'Tarifas' },
  { kind: 'servidores', label: 'Servidores' },
  { kind: 'referencias', label: 'Referencias' },
  { kind: 'metodos-pago', label: 'Métodos de pago' },
  { kind: 'categorias-gasto', label: 'Categorías de gasto' },
];
const selectClass =
  'w-full rounded-input border border-hover bg-background px-3 py-2 text-sm text-text-main';
const isActive = (row: CatalogRecord) => row.activo && !row.deletedAt;
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export default function CatalogosPage() {
  const [kind, setKind] = useState<CatalogKind>('productos');
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-text-main">Catálogos</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Gestiona las aplicaciones, precios y opciones de tu negocio.
        </p>
      </header>
      <nav aria-label="Tipos de catálogo" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.kind}
            variant={kind === tab.kind ? 'primary' : 'secondary'}
            aria-pressed={kind === tab.kind}
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      <CatalogPanel key={kind} kind={kind} />
    </div>
  );
}

function CatalogPanel({ kind }: { kind: CatalogKind }) {
  const client = useQueryClient();
  const [query, setQuery] = useState<CatalogQuery>({
    page: 1,
    limit: 25,
    estado: 'activo',
    sort: 'nombre',
    order: 'asc',
  });
  const [editing, setEditing] = useState<CatalogRecord | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const queryResult = useQuery({
    queryKey: ['catalogos', kind, query],
    queryFn: () => catalogosService.list(kind, query),
  });
  const products = useQuery({
    queryKey: ['catalogos', 'productos', 'options'],
    queryFn: catalogosService.productOptions,
    enabled: kind === 'tarifas',
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['catalogos'] }),
      client.invalidateQueries({ queryKey: ['importacion'] }),
    ]);
  };
  const activeMutation = useMutation({
    mutationFn: (row: CatalogRecord) => catalogosService.setActive(kind, row.id, !isActive(row)),
    onSuccess: async () => {
      setNotice('Estado actualizado. El historial se conserva.');
      setFailure('');
      setEditing(null);
      await refresh();
    },
    onError: (error) => setFailure(catalogError(error)),
  });
  const filter = (next: CatalogQuery) => {
    setQuery((old) => ({ ...old, ...next, page: 1 }));
  };
  const pagination = queryResult.data?.pagination;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Buscar por nombre"
          value={query.search ?? ''}
          onChange={(event) => filter({ search: event.target.value })}
        />
        <label className="space-y-1 text-sm text-text-secondary">
          Estado
          <select
            aria-label="Estado"
            className={selectClass}
            value={query.estado}
            onChange={(event) => filter({ estado: event.target.value as CatalogQuery['estado'] })}
          >
            <option value="activo">Activos disponibles</option>
            <option value="inactivo">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label className="space-y-1 text-sm text-text-secondary">
          Orden
          <select
            aria-label="Orden"
            className={selectClass}
            value={`${query.sort}:${query.order}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(':');
              filter({ sort: sort as CatalogQuery['sort'], order: order as CatalogQuery['order'] });
            }}
          >
            <option value="nombre:asc">Nombre A–Z</option>
            <option value="nombre:desc">Nombre Z–A</option>
            <option value="createdAt:desc">Más recientes</option>
          </select>
        </label>
        {kind === 'tarifas' && (
          <label className="space-y-1 text-sm text-text-secondary">
            Producto
            <select
              aria-label="Producto"
              className={selectClass}
              value={query.productoId ?? ''}
              onChange={(event) => filter({ productoId: event.target.value || undefined })}
            >
              <option value="">Todos los productos</option>
              {products.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      {products.isError && (
        <p role="alert" className="text-sm text-danger">
          {catalogError(products.error)}{' '}
          <Button variant="ghost" onClick={() => void products.refetch()}>
            Reintentar productos
          </Button>
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[320px_1fr]">
        <CatalogForm
          key={`${editing?.id ?? 'new'}-${formVersion}`}
          kind={kind}
          item={editing}
          products={products.data ?? []}
          onCancel={() => {
            setEditing(null);
            setFormVersion((value) => value + 1);
          }}
          onSaved={async () => {
            setEditing(null);
            setFormVersion((value) => value + 1);
            setNotice('Registro guardado.');
            setFailure('');
            await refresh();
          }}
        />
        <Card>
          <CardHeader>
            <CardTitle>{tabs.find((tab) => tab.kind === kind)?.label}</CardTitle>
            <Button
              variant="ghost"
              onClick={() => void queryResult.refetch()}
              loading={queryResult.isFetching}
            >
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {queryResult.isPending ? (
              <p role="status">Cargando catálogo…</p>
            ) : queryResult.isError ? (
              <p role="alert" className="text-danger">
                {catalogError(queryResult.error)}
              </p>
            ) : (
              <>
                {!queryResult.data.data.length && (
                  <p className="py-8 text-center text-text-secondary">
                    No hay registros para estos filtros. Puedes crear uno desde el formulario.
                  </p>
                )}
                <div className="space-y-3">
                  {queryResult.data.data.map((row) => (
                    <article
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-hover p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-medium text-text-main">{row.nombre}</p>
                        <p className="break-words text-sm text-text-secondary">
                          {kind === 'tarifas'
                            ? `${row.producto?.nombre} · 12 meses · ${money.format(Number(row.precio))}`
                            : (row.descripcion ?? row.observaciones ?? '')}
                        </p>
                        {kind === 'metodos-pago' && (
                          <p className="text-sm text-text-secondary">
                            {row.esGratuito
                              ? 'Gratuito · sin movimiento monetario'
                              : 'Cobro monetario'}
                          </p>
                        )}
                        {kind === 'tarifas' && row.producto && !isActive(row.producto) && (
                          <p className="text-xs text-warning">
                            Producto inactivo: tarifa no disponible para nuevas asignaciones.
                          </p>
                        )}
                      </div>
                      <Badge variant={isActive(row) ? 'success' : 'default'}>
                        {isActive(row) ? 'Activo' : 'Inactivo'}
                      </Badge>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(row);
                            setNotice('');
                            setFailure('');
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={activeMutation.isPending}
                          onClick={() => activeMutation.mutate(row)}
                        >
                          {isActive(row) ? 'Desactivar' : 'Reactivar'}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
                {pagination && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {pagination.total} registros · Página {pagination.page} de{' '}
                      {Math.max(1, pagination.totalPages)}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pagination.page <= 1}
                        onClick={() => setQuery((old) => ({ ...old, page: pagination.page - 1 }))}
                      >
                        Anterior
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pagination.page >= pagination.totalPages}
                        onClick={() => setQuery((old) => ({ ...old, page: pagination.page + 1 }))}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function CatalogForm({
  kind,
  item,
  products,
  onSaved,
  onCancel,
}: {
  kind: CatalogKind;
  item: CatalogRecord | null;
  products: CatalogRecord[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item?.nombre ?? '');
  const [description, setDescription] = useState(item?.descripcion ?? item?.observaciones ?? '');
  const [productId, setProductId] = useState(item?.productoId ?? '');
  const [price, setPrice] = useState(String(item?.precio ?? ''));
  const [free, setFree] = useState(item?.esGratuito ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const payload: CatalogPayload = { nombre: name.trim() };
    if (!payload.nombre) {
      setError('Introduce un nombre.');
      return;
    }
    if (kind === 'productos') payload.descripcion = description;
    if (kind === 'referencias') payload.observaciones = description;
    if (kind === 'metodos-pago') payload.esGratuito = free;
    if (kind === 'tarifas') {
      if (!productId || !price || Number(price) <= 0) {
        setError('Selecciona un producto e indica un precio mayor que cero.');
        return;
      }
      payload.productoId = productId;
      payload.precio = Number(price);
      payload.duracionMeses = 12;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await catalogosService.save(kind, payload, item?.id);
      await onSaved();
    } catch (error) {
      setError(catalogError(error));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  const activeProducts = products.filter(isActive);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item ? 'Editar registro' : 'Nuevo registro'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <Input
              label="Nombre"
              required
              maxLength={kind === 'referencias' ? 150 : 100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {(kind === 'productos' || kind === 'referencias') && (
              <Input
                label={kind === 'productos' ? 'Descripción' : 'Observaciones'}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
            {kind === 'tarifas' && (
              <>
                <label className="block space-y-1 text-sm text-text-secondary">
                  Producto
                  <select
                    aria-label="Producto"
                    className={selectClass}
                    required
                    disabled={Boolean(item)}
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                  >
                    <option value="">Selecciona un producto</option>
                    {item?.producto &&
                      !activeProducts.some((product) => product.id === item.productoId) && (
                        <option value={item.productoId}>{item.producto.nombre} (inactivo)</option>
                      )}
                    {activeProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Precio anual (€)"
                  type="number"
                  required
                  min="0.01"
                  max="99999999.99"
                  step="0.01"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
                <p className="text-sm text-text-secondary">Duración: 12 meses.</p>
                {!item && !activeProducts.length && (
                  <p className="text-sm text-warning">
                    Crea o activa un producto para añadir su tarifa.
                  </p>
                )}
              </>
            )}
            {kind === 'metodos-pago' && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={free}
                  onChange={(event) => setFree(event.target.checked)}
                />
                Método gratuito (sin movimiento monetario)
              </label>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={saving}>
              {item ? 'Guardar cambios' : 'Crear'}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

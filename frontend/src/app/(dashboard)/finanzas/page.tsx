'use client';
import { ExportButton } from '@/modules/exportaciones/export-button';
import { useListQuery } from '@/modules/configuracion/preferences';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { catalogOptions, todayMadrid } from '@/modules/suscripciones/suscripciones.service';
import { clientesService } from '@/modules/clientes/services/clientes.service';
import { selectStyle } from '@/modules/suscripciones/subscription-form';
import { money } from '@/modules/renovaciones/renovaciones.service';
import { finances, periodRange, type FinanceQuery } from '@/modules/finanzas/finanzas.service';
import { ExpenseDialog } from '@/modules/finanzas/expense-dialog';
export default function Page() {
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const [query, setQuery] = useListQuery<FinanceQuery>({
    page: 1,
    ...periodRange('mes', todayMadrid()),
  });
  const [period, setPeriod] = useState('mes');
  const [creating, setCreating] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const filters = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));
  const setFilter = (key: keyof FinanceQuery, value: string) =>
    setQuery((old) => ({ ...old, [key]: value, page: 1 }));
  const list = useQuery({
    queryKey: ['finanzas', 'list', filters],
    queryFn: () => finances.list(filters),
    refetchInterval: creating ? false : refreshInterval,
  });
  const summary = useQuery({
    queryKey: ['finanzas', 'balance', filters],
    queryFn: () => finances.balance(filters),
    refetchInterval: creating ? false : refreshInterval,
  });
  const options = useQuery({
    queryKey: ['catalogos', 'finanzas-filtros'],
    queryFn: async () => ({
      categories: await catalogOptions('categorias-gasto'),
      methods: await catalogOptions('metodos-pago'),
    }),
  });
  const clients = useQuery({
    queryKey: ['clientes', 'finanzas', clientSearch],
    queryFn: () =>
      clientesService.findAll({ search: clientSearch, limit: 25 }).then((r) => r.data.data),
  });
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Contabilidad</h1>
        <Button onClick={() => setCreating(true)}>Nuevo gasto</Button>
      </header>
      <ExportButton module="finanzas" filters={filters} />
      <p>
        Ingresos brutos y gastos pagados. Resultado operativo, sin comisiones automáticas ni cálculo
        fiscal.
      </p>
      <Link href="/catalogos" className="text-primary underline">
        Gestionar categorías y métodos de pago
      </Link>
      <section aria-label="Filtros financieros" className="k13-surface grid gap-4 rounded-card p-5 md:grid-cols-3">
        <label>
          Periodo
          <select
            aria-label="Periodo"
            className={selectStyle}
            value={period}
            onChange={(e) => {
              const value = e.target.value;
              setPeriod(value);
              if (value !== 'personalizado')
                setQuery((old) => ({ ...old, ...periodRange(value, todayMadrid()), page: 1 }));
            }}
          >
            {[
              ['hoy', 'Hoy'],
              ['semana', 'Semana'],
              ['mes', 'Mes'],
              ['trimestre', 'Trimestre'],
              ['ano', 'Año'],
              ['todas', 'Todo el histórico'],
              ['personalizado', 'Personalizado'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Desde"
          type="date"
          value={query.desde ?? ''}
          onChange={(e) => {
            setPeriod('personalizado');
            setFilter('desde', e.target.value);
          }}
        />
        <Input
          label="Hasta"
          type="date"
          value={query.hasta ?? ''}
          onChange={(e) => {
            setPeriod('personalizado');
            setFilter('hasta', e.target.value);
          }}
        />
        <label>
          Tipo
          <select
            aria-label="Tipo"
            className={selectStyle}
            value={query.tipo ?? ''}
            onChange={(e) => setFilter('tipo', e.target.value)}
          >
            <option value="">Todos</option>
            <option value="INGRESO">Ingreso</option>
            <option value="GASTO">Gasto</option>
          </select>
        </label>
        <label>
          Estado
          <select
            aria-label="Estado"
            className={selectStyle}
            value={query.estado ?? ''}
            onChange={(e) => setFilter('estado', e.target.value)}
          >
            <option value="">Todos</option>
            <option value="CONFIRMADO">Confirmado</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="ANULADO">Anulado</option>
          </select>
        </label>
        <Input
          label="Buscar concepto u observaciones"
          value={query.search ?? ''}
          onChange={(e) => setFilter('search', e.target.value)}
        />
        <label>
          Categoría
          <select
            aria-label="Filtrar categoría"
            className={selectStyle}
            value={query.categoriaGastoId ?? ''}
            onChange={(e) => setFilter('categoriaGastoId', e.target.value)}
          >
            <option value="">Todas</option>
            {options.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Método de pago
          <select
            aria-label="Filtrar método de pago"
            className={selectStyle}
            value={query.metodoPagoId ?? ''}
            onChange={(e) => setFilter('metodoPagoId', e.target.value)}
          >
            <option value="">Todos</option>
            {options.data?.methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Buscar cliente"
          value={clientSearch}
          onChange={(e) => {
            setClientSearch(e.target.value);
            setFilter('clienteId', '');
          }}
        />
        <label>
          Cliente
          <select
            aria-label="Filtrar cliente"
            className={selectStyle}
            value={query.clienteId ?? ''}
            onChange={(e) => setFilter('clienteId', e.target.value)}
          >
            <option value="">Todos</option>
            {clients.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      </section>
      <p className="text-sm">
        Resumen de todos los movimientos filtrados, no solo de esta página. Pendientes por fecha de
        operación; confirmados por fecha de pago. El ticket medio solo incluye ingresos confirmados.
      </p>
      {[list, summary, options, clients].some((q) => q.isError) && (
        <div role="alert">
          No se pudieron cargar algunos datos. {list.error && catalogError(list.error)}{' '}
          <Button
            onClick={() => {
              void list.refetch();
              void summary.refetch();
              void options.refetch();
              void clients.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      )}
      {summary.isPending && <p role="status">Calculando balance…</p>}
      {summary.data && !summary.isError && (
        <section aria-label="Balance" className="k13-metrics grid gap-3 md:grid-cols-4">
          {[
            ['Ingresos', money(summary.data.ingresos)],
            ['Gastos', money(summary.data.gastos)],
            ['Resultado', money(summary.data.resultado)],
            ['Pendiente de cobro', money(summary.data.pendienteCobro)],
            ['Ingresos confirmados', summary.data.numeroIngresos],
            ['Gastos confirmados', summary.data.numeroGastos],
            ['Operaciones confirmadas', summary.data.numeroOperaciones],
            ['Ticket medio', money(summary.data.ticketMedio)],
          ].map(([label, value]) => (
            <div className="border-hover rounded border p-3" key={label}>
              <h2>{label}</h2>
              <p className="text-xl">{value}</p>
            </div>
          ))}
        </section>
      )}
      {list.isPending && <p role="status">Cargando movimientos…</p>}
      {list.data && !list.isError && (
        <>
          {!list.data.data.length ? (
            <p>No hay movimientos para estos filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      'Fecha',
                      'Tipo',
                      'Concepto / cliente',
                      'Estado',
                      'Método',
                      'Importe',
                      'Detalle',
                    ].map((t) => (
                      <th className="p-2" key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((row) => (
                    <tr key={row.id} className="border-hover border-t">
                      <td className="p-2">{dateLabel(row.fechaCobro ?? row.fecha)}</td>
                      <td className="p-2">{row.tipo.etiqueta}</td>
                      <td className="p-2">
                        {row.concepto ?? row.descripcion ?? 'Movimiento'}
                        {row.suscripcion && <p>{row.suscripcion.cliente.nombre}</p>}
                      </td>
                      <td className="p-2">{row.estado.etiqueta}</td>
                      <td className="p-2">
                        {row.metodoPagoNombreSnapshot ??
                          row.metodoPago?.nombre ??
                          'Sin dato histórico'}
                      </td>
                      <td className="p-2">{money(row.importe)}</td>
                      <td className="p-2">
                        <Link className="text-primary underline" href={'/finanzas/' + row.id}>
                          Ver movimiento
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              disabled={(query.page ?? 1) <= 1}
              onClick={() => setQuery((old) => ({ ...old, page: (old.page ?? 1) - 1 }))}
            >
              Anterior
            </Button>
            <span>
              Página {query.page} · {list.data.pagination.total} movimientos
            </span>
            <Button
              disabled={(query.page ?? 1) >= list.data.pagination.totalPages}
              onClick={() => setQuery((old) => ({ ...old, page: (old.page ?? 1) + 1 }))}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
      {creating && <ExpenseDialog action={{ kind: 'crear' }} onClose={() => setCreating(false)} />}
    </div>
  );
}

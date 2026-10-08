'use client';
import {
  usePreferences,
  useDateLabel,
  useRefreshInterval,
} from '@/modules/configuracion/preferences';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  CreditCard,
  RefreshCw,
  Wallet,
  UserPlus,
  Receipt,
  TrendingUp,
  Clock,
  Plus,
  Search,
  ArrowRight,
  CalendarDays,
} from 'lucide-react';
import { dashboard } from '@/modules/dashboard/dashboard.service';
import { Kpi, FinanceChart } from '@/modules/dashboard/dashboard-widgets';
import { todayMadrid } from '@/modules/suscripciones/suscripciones.service';
import { money } from '@/modules/renovaciones/renovaciones.service';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { ExpenseDialog } from '@/modules/finanzas/expense-dialog';
import { ClienteFormModal } from '@/modules/clientes/components/cliente-form-modal';
import { useCreateCliente } from '@/modules/clientes/hooks/use-clientes';
import type { ClienteFormData } from '@/modules/clientes/schemas/cliente.schema';
import './dashboard.css';

function relativePeriod(preset: string, today: string) {
  const date = new Date(today + 'T00:00:00Z');
  if (preset === 'semana') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (preset === 'mes') date.setUTCDate(1);
  if (preset === 'ano') date.setUTCMonth(0, 1);
  return { desde: date.toISOString().slice(0, 10), hasta: today };
}

export default function DashboardPage() {
  const brand = usePreferences()['negocio.nombre'];
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const [today, setToday] = useState(todayMadrid);
  const [dates, setDates] = useState(() => relativePeriod('mes', today));
  const [customRange, setCustomRange] = useState(dates),
    [preset, setPreset] = useState('mes'),
    [dateError, setDateError] = useState('');
  const range = preset === 'personalizado' ? customRange : relativePeriod(preset, today);
  useEffect(() => {
    // Los rangos relativos siguen el día civil de Madrid, incluso al despertar
    // una pestaña suspendida. Ni el periodo personalizado ni su borrador cambian.
    const syncDay = () => setToday(todayMadrid());
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncDay();
    };
    syncDay();
    const timer = window.setInterval(syncDay, 30000);
    window.addEventListener('focus', syncDay);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', syncDay);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [estado, setEstado] = useState('');
  const [expense, setExpense] = useState(false),
    [client, setClient] = useState(false),
    [saveError, setSaveError] = useState('');
  const create = useCreateCliente();
  const report = useQuery({
    queryKey: ['dashboard', 'summary', range],
    queryFn: () => dashboard.get(range),
    refetchInterval: expense || client ? false : refreshInterval,
  });
  const clients = useQuery({
    queryKey: ['dashboard', 'clients', page, search, estado],
    queryFn: () =>
      dashboard.clients({ page, search: search || undefined, estado: estado || undefined }),
    refetchInterval: client ? false : refreshInterval,
  });
  useEffect(() => {
    if (clients.isSuccess && !clients.isFetching && clients.data.pagination.page === page) {
      const lastPage = Math.max(1, clients.data.pagination.totalPages);
      if (page > lastPage) setPage(lastPage);
    }
  }, [clients.data, clients.isSuccess, clients.isFetching, page]);
  const data = report.data;
  const apply = () => {
    const span = (Date.parse(dates.hasta) - Date.parse(dates.desde)) / 86400000 + 1;
    if (!Number.isFinite(span) || span < 1 || span > 366) {
      setDateError('Selecciona un periodo de entre 1 y 366 días.');
      return;
    }
    setDateError('');
    setCustomRange(dates);
  };
  const choose = (value: string) => {
    if (value === 'personalizado' && preset !== 'personalizado') {
      setDates(range);
      setCustomRange(range);
    }
    setPreset(value);
    setDateError('');
  };
  async function saveClient(input: ClienteFormData) {
    try {
      await create.mutateAsync(input);
      setClient(false);
      setSaveError('');
    } catch (error) {
      setSaveError(catalogError(error));
    }
  }
  return (
    <div className="k13-dashboard">
      <div className="k13-dashboard-heading">
        <div>
          <p className="k13-eyebrow">{brand} · CENTRO DE CONTROL</p>
          <h1>Dashboard</h1>
          <p>Resumen general de tu negocio</p>
        </div>
        <div className="k13-range">
          <CalendarDays size={17} />
          <label className="sr-only" htmlFor="dashboard-period">
            Periodo
          </label>
          <select id="dashboard-period" value={preset} onChange={(e) => choose(e.target.value)}>
            <option value="hoy">Hoy</option>
            <option value="semana">Esta semana hasta hoy</option>
            <option value="mes">Este mes hasta hoy</option>
            <option value="ano">Este año hasta hoy</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
      </div>
      {preset === 'personalizado' && (
        <div className="k13-custom-range">
          <label>
            Desde
            <input
              type="date"
              value={dates.desde}
              onChange={(e) => setDates({ ...dates, desde: e.target.value })}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={dates.hasta}
              onChange={(e) => setDates({ ...dates, hasta: e.target.value })}
            />
          </label>
          <button className="k13-button" onClick={apply}>
            Aplicar periodo
          </button>
          {dateError && <p role="alert">{dateError}</p>}
        </div>
      )}
      {report.isPending && (
        <div role="status" className="k13-loading">
          Cargando indicadores del negocio…
        </div>
      )}
      {report.isError && (
        <div role="alert" className="k13-error">
          {catalogError(report.error)}{' '}
          <button className="k13-button" onClick={() => void report.refetch()}>
            Reintentar resumen
          </button>
        </div>
      )}
      {data && !report.isError && (
        <>
          <section className="k13-kpis" aria-label="Indicadores del negocio">
            <Kpi
              title="Clientes con servicio"
              value={data.indicadores.clientesVigentes}
              tone="blue"
              icon={Users}
              caption="Clientes únicos · Ahora"
              href="#listado-clientes"
            />
            <Kpi
              title="Suscripciones vigentes"
              value={data.indicadores.suscripcionesVigentes}
              tone="pink"
              icon={CreditCard}
              caption="Activas y próximas · Ahora"
              href="/suscripciones"
            />
            <Kpi
              title="Renovaciones realizadas"
              value={data.indicadores.renovaciones}
              tone="orange"
              icon={RefreshCw}
              caption="Periodo anterior"
              change={data.variacion.renovaciones}
              series={data.serie.map((r) => r.renovaciones)}
              href="/renovaciones?historial=1"
            />
            <Kpi
              title="Ingresos brutos"
              value={money(data.indicadores.ingresos)}
              tone="green"
              icon={Wallet}
              caption="Periodo anterior"
              change={data.variacion.ingresos}
              series={data.serie.map((r) => Number(r.ingresos))}
              href="/finanzas"
            />
            <Kpi
              title="Nuevos clientes"
              value={data.indicadores.nuevosClientes}
              tone="purple"
              icon={UserPlus}
              caption="Periodo anterior"
              change={data.variacion.nuevosClientes}
              series={data.serie.map((r) => r.clientes)}
              href="#listado-clientes"
            />
            <Kpi
              title="Gastos pagados"
              value={money(data.indicadores.gastos)}
              tone="cyan"
              icon={Receipt}
              caption="Periodo anterior"
              change={data.variacion.gastos}
              series={data.serie.map((r) => Number(r.gastos))}
              href="/finanzas"
            />
            <Kpi
              title="Resultado operativo"
              value={money(data.indicadores.resultado)}
              tone="gold"
              icon={TrendingUp}
              caption="Periodo anterior"
              change={data.variacion.resultado}
              series={data.serie.map((r) => Number(r.ingresos) - Number(r.gastos))}
              href="/finanzas"
            />
            <Kpi
              title="Pendiente de cobro"
              value={money(data.indicadores.pendienteCobro)}
              tone="violet"
              icon={Clock}
              caption={`${data.indicadores.numeroPendientes} cobros · Todo el histórico`}
              href="#trabajo-pendiente"
            />
          </section>
          <p className="k13-period-note">
            Periodo: {dateLabel(data.periodo.desde)} – {dateLabel(data.periodo.hasta)} ·
            Comparación: {dateLabel(data.periodo.anteriorDesde)} –{' '}
            {dateLabel(data.periodo.anteriorHasta)}. Sin reconstruir estados históricos.
          </p>
        </>
      )}
      <section id="listado-clientes" className="k13-panel" aria-label="Listado de clientes">
        <div className="k13-panel-heading">
          <div>
            <h2>Listado de clientes</h2>
            <small>Situación actual · Independiente del periodo</small>
          </div>
          <div className="k13-table-tools">
            <label className="k13-search">
              <Search size={16} />
              <span className="sr-only">Buscar cliente por nombre o teléfono</span>
              <input
                placeholder="Buscar cliente…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Filtrar estado del cliente</span>
              <select
                value={estado}
                onChange={(e) => {
                  setEstado(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos los estados</option>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>
            <button
              className="k13-button primary"
              onClick={() => {
                setSaveError('');
                setClient(true);
              }}
            >
              <Plus size={17} />
              Nuevo cliente
            </button>
          </div>
        </div>
        {clients.isPending && (
          <p className="k13-empty" role="status">
            Cargando clientes…
          </p>
        )}
        {clients.isError && (
          <p role="alert" className="k13-error">
            {catalogError(clients.error)}{' '}
            <button className="k13-button" onClick={() => void clients.refetch()}>
              Reintentar clientes
            </button>
          </p>
        )}
        {clients.data && !clients.isError && (
          <>
            <div className="k13-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Suscripciones</th>
                    <th>Estado cliente</th>
                    <th>Próxima renovación</th>
                    <th>Registro</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.data.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={'/clientes/' + row.id}>{row.nombre}</Link>
                      </td>
                      <td>{row.telefono ?? '—'}</td>
                      <td>{row.numeroSuscripciones}</td>
                      <td>
                        <span
                          className={
                            'k13-badge ' + (row.estado.valor === 'ACTIVO' ? 'active' : 'inactive')
                          }
                        >
                          {row.estado.etiqueta}
                        </span>
                      </td>
                      <td>
                        {row.proximaRenovacion ? (
                          <Link href={'/suscripciones/' + row.proximaRenovacion.id}>
                            {dateLabel(row.proximaRenovacion.fechaFin)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {new Date(row.createdAt).toLocaleDateString('es-ES', {
                          timeZone: 'Europe/Madrid',
                        })}
                      </td>
                      <td>
                        <Link
                          className="k13-row-link"
                          href={'/clientes/' + row.id}
                          aria-label={'Ver cliente ' + row.nombre}
                        >
                          Ver <ArrowRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!clients.data.data.length && (
              <p className="k13-empty">No hay clientes para estos filtros.</p>
            )}
            <div className="k13-pagination">
              <span>
                {clients.data.pagination.total} clientes · Página {page} de{' '}
                {Math.max(1, clients.data.pagination.totalPages)}
              </span>
              <div>
                <button
                  className="k13-button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </button>
                <button
                  className="k13-button"
                  disabled={page >= clients.data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <div className="k13-quick-actions">
        <span>Acciones rápidas</span>
        <Link className="k13-button" href="/suscripciones/nueva">
          <Plus size={16} />
          Nueva suscripción
        </Link>
        <Link className="k13-button" href="/renovaciones">
          <RefreshCw size={16} />
          Gestionar renovaciones
        </Link>
        <button className="k13-button" onClick={() => setExpense(true)}>
          <Receipt size={16} />
          Registrar gasto
        </button>
        <Link className="k13-button" href="/catalogos">
          Abrir catálogos <ArrowRight size={15} />
        </Link>
      </div>
      {data && !report.isError && (
        <>
          <section id="trabajo-pendiente" className="k13-work" aria-label="Trabajo pendiente">
            <article className="k13-panel">
              <div className="k13-panel-heading">
                <h2>Renovaciones que requieren atención</h2>
                <Link href="/renovaciones">
                  Ver todas <ArrowRight size={14} />
                </Link>
              </div>
              <div className="k13-work-counts">
                <span>
                  <b>{data.trabajo.vencidas}</b> vencidas
                </span>
                <span>
                  <b>{data.trabajo.hoy}</b> hoy
                </span>
                <span>
                  <b>{data.trabajo.proximas}</b> próximos {data.trabajo.diasAviso} días
                </span>
              </div>
              {data.trabajo.renovaciones.map((row) => (
                <Link key={row.id} className="k13-task" href={'/suscripciones/' + row.id}>
                  <span>
                    {row.cliente.nombre}
                    <small>{row.producto.nombre}</small>
                  </span>
                  <span
                    className={'k13-badge ' + (row.fechaFin.slice(0, 10) <= data.hoy ? 'due' : '')}
                  >
                    {dateLabel(row.fechaFin)}
                  </span>
                </Link>
              ))}
              {!data.trabajo.renovaciones.length && (
                <p className="k13-empty">No hay renovaciones que requieran atención.</p>
              )}
            </article>
            <article className="k13-panel">
              <div className="k13-panel-heading">
                <h2>Cobros pendientes</h2>
                <span>{money(data.indicadores.pendienteCobro)}</span>
              </div>
              {data.trabajo.cobros.map((row) => (
                <Link key={row.id} className="k13-task" href={'/finanzas/' + row.id}>
                  <span>
                    {row.suscripcion?.cliente.nombre ?? 'Ingreso pendiente'}
                    <small>
                      Previsto:{' '}
                      {row.fechaPrevistaCobro ? dateLabel(row.fechaPrevistaCobro) : 'Sin fecha'}
                    </small>
                  </span>
                  <strong>{money(row.importe)}</strong>
                </Link>
              ))}
              {!data.trabajo.cobros.length && (
                <p className="k13-empty">No hay cobros pendientes.</p>
              )}
            </article>
          </section>
          <div className="k13-work">
            <section className="k13-panel">
              <div className="k13-panel-heading">
                <div>
                  <h2>Evolución económica</h2>
                  <small>Confirmados por fecha de pago · Sin comisiones automáticas</small>
                </div>
              </div>
              <FinanceChart rows={data.serie} />
            </section>
            <section className="k13-panel">
              <div className="k13-panel-heading">
                <h2>Avisos internos</h2>
                <small>Hasta los próximos {data.trabajo.diasAviso} días</small>
              </div>
              {data.trabajo.recordatorios.map((row) => (
                <Link className="k13-task" key={row.id} href={'/recordatorios/' + row.id}>
                  <span>
                    {row.cliente.nombre}
                    <small>{row.tipo.etiqueta}</small>
                  </span>
                  <span>{dateLabel(row.fecha)}</span>
                </Link>
              ))}
              {!data.trabajo.recordatorios.length && (
                <p className="k13-empty">No hay avisos internos próximos.</p>
              )}
              <p className="k13-panel-footnote">
                <Link href="/recordatorios">Gestionar avisos</Link> ·{' '}
                <Link href="/calendario">Ver calendario</Link>. Solo avisos dentro de la web.
              </p>
            </section>
          </div>
          <section className="k13-panel">
            <div className="k13-panel-heading">
              <h2>Actividad reciente</h2>
              <small>Últimos 8 cambios del sistema</small>
            </div>
            <div className="k13-activity">
              {data.actividad.map((row) => (
                <div key={row.id}>
                  <span className="k13-activity-dot" />
                  <p>
                    {row.tabla.replaceAll('_', ' ')} · {row.accion.replaceAll('_', ' ')}
                    <small>{row.usuario?.nombre ?? 'Sistema'}</small>
                  </p>
                  <time>
                    {new Date(row.createdAt).toLocaleString('es-ES', {
                      timeZone: 'Europe/Madrid',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
              ))}
              {!data.actividad.length && (
                <p className="k13-empty">Todavía no hay actividad registrada.</p>
              )}
            </div>
          </section>
          <p className="k13-period-note">
            Actualizado:{' '}
            {new Date(data.actualizado).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' })}{' '}
            · Refresco automático cada minuto. Solo se muestran datos registrados.
          </p>
          <p className="k13-period-note">
            {data.calidadImportacion.ultima ? (
              <>
                Importación: {data.calidadImportacion.ultima.estado.replaceAll('_', ' ')} ·{' '}
                {data.calidadImportacion.pendientes} filas sin conciliar ·{' '}
                {data.calidadImportacion.bloqueadas} bloqueadas o en conflicto ·{' '}
                {data.calidadImportacion.pendientesFinancieras} pendientes financieras.{' '}
                <Link href="/importaciones">Revisar importaciones y duplicados</Link>
              </>
            ) : (
              'El histórico del XLSX sigue aplazado. No es necesario importarlo para trabajar con el dashboard.'
            )}
          </p>
        </>
      )}
      {expense && <ExpenseDialog action={{ kind: 'crear' }} onClose={() => setExpense(false)} />}
      <ClienteFormModal
        open={client}
        onClose={() => {
          if (!create.isPending) setClient(false);
        }}
        onSubmit={saveClient}
        isLoading={create.isPending}
        error={saveError}
      />
    </div>
  );
}

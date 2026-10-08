'use client';
import { useConfiguredPage } from '@/modules/configuracion/preferences';
import {
  usePreferences,
  useDateLabel,
  useRefreshInterval,
} from '@/modules/configuracion/preferences';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart2, RefreshCw } from 'lucide-react';
import {
  stats,
  sections,
  type Section,
  type Grain,
  type Filters,
} from '@/modules/estadisticas/estadisticas.service';
import { Series, Bars } from '@/modules/estadisticas/charts';
import { CatalogFilter } from '@/modules/estadisticas/catalog-filter';
import { todayMadrid } from '@/modules/suscripciones/suscripciones.service';
import { money } from '@/modules/renovaciones/renovaciones.service';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import '../dashboard/dashboard.css';
import './estadisticas.css';
type Range = { desde: string; hasta: string };
const relative = (preset: string, today: string): Range => {
  const d = new Date(today + 'T00:00:00Z');
  if (preset === 'semana') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (['mes', 'trimestre', 'ano', '12meses'].includes(preset)) d.setUTCDate(1);
  if (preset === 'trimestre') d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3);
  if (preset === 'ano') d.setUTCMonth(0);
  if (preset === '12meses') d.setUTCMonth(d.getUTCMonth() - 11);
  return { desde: d.toISOString().slice(0, 10), hasta: today };
};
function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <article className="stats-metric">
      <h3>{label}</h3>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}
const percent = (value: string | null) =>
  value === null
    ? 'Sin base de comparación'
    : Number(value).toLocaleString('es-ES', { maximumFractionDigits: 1 }) +
      ' % vs periodo anterior';
export default function Page() {
  return (
    <Suspense fallback={<p>Cargando estadísticas…</p>}>
      <StatisticsPage />
    </Suspense>
  );
}
function StatisticsPage() {
  const params = useSearchParams();
  const brand = usePreferences()['negocio.nombre'];
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const cache = useQueryClient();
  const [today, setToday] = useState(todayMadrid),
    [section, setSection] = useState<Section>('resumen'),
    [preset, setPreset] = useState('mes'),
    [grain, setGrain] = useState<Grain>('mes');
  const [custom, setCustom] = useState<Range>(() => relative('mes', today)),
    [draft, setDraft] = useState(custom),
    [error, setError] = useState(''),
    [page, setPage, pageLimit] = useConfiguredPage();
  const [filters, setFilters] = useState<Partial<Record<Section, Filters>>>({}),
    [ready, setReady] = useState(false);
  const range = preset === 'personalizado' ? custom : relative(preset, today),
    filter = filters[section] ?? {};
  useEffect(() => {
    const sync = () => setToday(todayMadrid());
    const visible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    sync();
    const timer = setInterval(sync, 30000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('k13-stats-v1') ?? 'null');
      if (
        saved &&
        Object.hasOwn(sections, saved.section) &&
        ['hoy', 'semana', 'mes', 'trimestre', 'ano', '12meses', 'personalizado'].includes(
          saved.preset,
        ) &&
        ['dia', 'mes', 'ano'].includes(saved.grain) &&
        /^\d{4}-\d{2}-\d{2}$/.test(saved.custom?.desde) &&
        /^\d{4}-\d{2}-\d{2}$/.test(saved.custom?.hasta)
      ) {
        setSection(saved.section);
        setPreset(saved.preset);
        setGrain(saved.grain);
        setCustom(saved.custom);
        setDraft(saved.custom);
        if (saved.filters && typeof saved.filters === 'object') setFilters(saved.filters);
      }
    } catch {}
    const reference = params.get('referenciaId');
    if (reference) {
      setSection('referencias');
      setPreset('mes');
      setFilters({ referencias: { referenciaId: reference } });
      setPage(1);
    }
    setReady(true);
  }, [params, setPage]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(
          'k13-stats-v1',
          JSON.stringify({ section, preset, grain, custom, filters }),
        );
      } catch {}
  }, [ready, section, preset, grain, custom, filters]);
  const validate = (r: Range) => {
    const from = new Date(r.desde + 'T00:00:00Z'),
      to = new Date(r.hasta + 'T00:00:00Z'),
      max = new Date(from);
    max.setUTCFullYear(max.getUTCFullYear() + 5);
    return !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from.toISOString().slice(0, 10) !== r.desde ||
      to.toISOString().slice(0, 10) !== r.hasta ||
      from.getUTCFullYear() < 1005 ||
      to.getUTCFullYear() > 9997 ||
      from > to ||
      to >= max ||
      (grain === 'dia' && (to.getTime() - from.getTime()) / 86400000 + 1 > 366)
      ? 'Selecciona un periodo válido de hasta cinco años; máximo 366 días para detalle diario.'
      : '';
  };
  const rangeError = validate(range);
  const report = useQuery({
    queryKey: ['estadisticas', section, range, grain, page, pageLimit, filter],
    queryFn: () =>
      stats.get(section, { ...range, agrupacion: grain, page, limit: pageLimit, ...filter }),
    enabled: ready && !rangeError,
    staleTime: 0,
    refetchInterval: refreshInterval,
  });
  const data = rangeError ? undefined : report.data;
  useEffect(() => {
    const p = report.data?.ranking?.pagination;
    if (
      report.isSuccess &&
      !report.isFetching &&
      p?.page === page &&
      page > Math.max(1, p.totalPages)
    )
      setPage(Math.max(1, p.totalPages));
  }, [report.data, report.isSuccess, report.isFetching, page, setPage]);
  const changeFilter = (key: keyof Filters, value: string) => {
    const next = { ...filter };
    if (value) next[key] = value;
    else delete next[key];
    if (key === 'metodoPagoId') delete next.categoriaGastoId;
    if (key === 'categoriaGastoId') delete next.metodoPagoId;
    setFilters({ ...filters, [section]: next });
    setPage(1);
  };
  const choose = (value: string) => {
    if (value === 'personalizado') {
      setCustom(range);
      setDraft(range);
    }
    setPreset(value);
    setPage(1);
    setError('');
  };
  const dimension = ['productos', 'servidores', 'referencias'].includes(section);
  return (
    <div className="k13-dashboard stats-page">
      <div className="k13-dashboard-heading">
        <div>
          <p className="k13-eyebrow">{brand} · ANÁLISIS DEL NEGOCIO</p>
          <h1>Estadísticas</h1>
          <p>Datos registrados, comparativas claras y decisiones informadas.</p>
        </div>
        <BarChart2 size={32} />
      </div>
      <nav className="stats-tabs" aria-label="Informes estadísticos">
        {Object.entries(sections).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={section === key}
            onClick={() => {
              setSection(key as Section);
              setPage(1);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="k13-panel stats-filters" aria-label="Filtros del informe">
        <div className="stats-toolbar">
          <label>
            Periodo
            <select aria-label="Periodo" value={preset} onChange={(e) => choose(e.target.value)}>
              <option value="hoy">Hoy</option>
              <option value="semana">Semana hasta hoy</option>
              <option value="mes">Mes hasta hoy</option>
              <option value="trimestre">Trimestre hasta hoy</option>
              <option value="ano">Año hasta hoy</option>
              <option value="12meses">Últimos 12 meses</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </label>
          <label>
            Agrupación
            <select
              aria-label="Agrupación"
              value={grain}
              onChange={(e) => {
                setGrain(e.target.value as Grain);
                setError('');
                setPage(1);
              }}
            >
              <option value="dia">Diaria</option>
              <option value="mes">Mensual</option>
              <option value="ano">Anual</option>
            </select>
          </label>
          <button
            className="k13-button"
            disabled={!ready || !!rangeError || report.isFetching}
            onClick={() => {
              // Refrescar también los desplegables, conservando sus filtros y selección.
              void Promise.all([
                report.refetch(),
                cache.invalidateQueries({ queryKey: ['catalogos'] }),
              ]);
            }}
          >
            <RefreshCw size={16} />
            Actualizar
          </button>
        </div>
        {preset === 'personalizado' && (
          <div className="k13-custom-range">
            <label>
              Desde
              <input
                type="date"
                value={draft.desde}
                onChange={(e) => setDraft({ ...draft, desde: e.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={draft.hasta}
                onChange={(e) => setDraft({ ...draft, hasta: e.target.value })}
              />
            </label>
            <button
              className="k13-button"
              onClick={() => {
                const message = validate(draft);
                setError(message);
                if (!message) {
                  setCustom(draft);
                  setPage(1);
                }
              }}
            >
              Aplicar fechas
            </button>
          </div>
        )}
        <div className="stats-filter-grid">
          {dimension && (
            <>
              <CatalogFilter
                kind="productos"
                title="Producto"
                value={filter.productoId ?? ''}
                onChange={(v) => changeFilter('productoId', v)}
              />
              <CatalogFilter
                kind="servidores"
                title="Servidor"
                value={filter.servidorId ?? ''}
                onChange={(v) => changeFilter('servidorId', v)}
              />
              <CatalogFilter
                kind="referencias"
                title="Referencia"
                value={filter.referenciaId ?? ''}
                onChange={(v) => changeFilter('referenciaId', v)}
              />
            </>
          )}
          {['finanzas', 'metodos-pago'].includes(section) && (
            <CatalogFilter
              kind="metodos-pago"
              title="Método de pago (ingresos)"
              value={filter.metodoPagoId ?? ''}
              onChange={(v) => changeFilter('metodoPagoId', v)}
            />
          )}{' '}
          {section === 'finanzas' && (
            <CatalogFilter
              kind="categorias-gasto"
              title="Categoría de gasto"
              value={filter.categoriaGastoId ?? ''}
              onChange={(v) => changeFilter('categoriaGastoId', v)}
            />
          )}{' '}
          {section === 'clientes' && (
            <label>
              Estado actual del cliente
              <select
                value={filter.estadoCliente ?? ''}
                onChange={(e) => changeFilter('estadoCliente', e.target.value)}
              >
                <option value="">Todos</option>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>
          )}
          {section === 'renovaciones' && (
            <label>
              Estado de las operaciones
              <select
                value={filter.estadoOperacion ?? ''}
                onChange={(e) => changeFilter('estadoOperacion', e.target.value)}
              >
                <option value="">Todos</option>
                <option value="COMPLETADA">Completadas</option>
                <option value="ANULADA">Anuladas</option>
              </select>
            </label>
          )}
        </div>
        {!!Object.keys(filter).length && (
          <button
            className="k13-button"
            onClick={() => {
              setFilters({ ...filters, [section]: {} });
              setPage(1);
            }}
          >
            Limpiar filtros del informe
          </button>
        )}
      </section>
      {(error || rangeError) && (
        <p role="alert" className="k13-error">
          {error || rangeError}
        </p>
      )}
      {!rangeError && report.isPending && (
        <p role="status" className="k13-loading">
          Calculando estadísticas…
        </p>
      )}
      {report.isError && (
        <p role="alert" className="k13-error">
          {catalogError(report.error)}{' '}
          <button className="k13-button" onClick={() => void report.refetch()}>
            Reintentar informe
          </button>
        </p>
      )}
      {data && !report.isError && (
        <>
          <p className="k13-period-note">
            {dateLabel(data.periodo.desde)} – {dateLabel(data.periodo.hasta)} · Comparación:{' '}
            {dateLabel(data.periodo.anteriorDesde)} – {dateLabel(data.periodo.anteriorHasta)} ·
            Fechas de Madrid.
          </p>
          {data.finanzas && (
            <section className="k13-panel" aria-label="Análisis financiero">
              <div className="k13-panel-heading">
                <h2>Economía del periodo</h2>
              </div>
              <div className="stats-metrics">
                <Metric
                  label="Ingresos brutos"
                  value={
                    data.finanzas.ingresos === null ? 'No aplicable' : money(data.finanzas.ingresos)
                  }
                  note={percent(data.finanzas.variacion.ingresos)}
                />
                <Metric
                  label="Gastos pagados"
                  value={
                    data.finanzas.gastos === null ? 'No aplicable' : money(data.finanzas.gastos)
                  }
                  note={percent(data.finanzas.variacion.gastos)}
                />
                <Metric
                  label="Resultado operativo"
                  value={
                    data.finanzas.resultado === null
                      ? 'No aplicable'
                      : money(data.finanzas.resultado)
                  }
                  note={percent(data.finanzas.variacion.resultado)}
                />
                <Metric
                  label="Ticket medio cobrado"
                  value={
                    data.finanzas.ticketMedio === null
                      ? 'No aplicable'
                      : money(data.finanzas.ticketMedio)
                  }
                  note={`${data.finanzas.numeroIngresos} ingresos confirmados`}
                />
              </div>
              <p className="stats-note">
                Confirmados por fecha de pago; sin descontar comisiones. Los pendientes y anulados
                no suman. Con un filtro exclusivo de ingresos o gastos no se calcula resultado.
              </p>
              <Series
                rows={data.finanzas.serie}
                columns={[
                  ...(data.finanzas.ingresos !== null
                    ? [{ key: 'ingresos', label: 'Ingresos', color: '#32e4b0', currency: true }]
                    : []),
                  ...(data.finanzas.gastos !== null
                    ? [{ key: 'gastos', label: 'Gastos', color: '#ffb459', currency: true }]
                    : []),
                  ...(data.finanzas.resultado !== null
                    ? [{ key: 'resultado', label: 'Resultado', color: '#52baff', currency: true }]
                    : []),
                ]}
              />
            </section>
          )}
          {data.clientes && (
            <section className="k13-panel" aria-label="Análisis de clientes">
              <div className="k13-panel-heading">
                <h2>Clientes</h2>
                <small>Personas únicas, no suscripciones</small>
              </div>
              <div className="stats-metrics">
                <Metric
                  label="Altas del periodo"
                  value={data.clientes.altas}
                  note={percent(data.clientes.variacion)}
                />
                <Metric label="Con servicio ahora" value={data.clientes.actual.vigentes} />
                <Metric
                  label="Perdidos ahora"
                  value={data.clientes.actual.perdidos}
                  note="30 días desde el último vencimiento, sin servicio vigente"
                />
                <Metric
                  label="Con algún No renovar"
                  value={data.clientes.actual.noRenovar}
                  note="Situación actual"
                />
              </div>
              <p className="stats-note">
                El estado filtra únicamente la situación actual, no las altas históricas. No se
                reconstruyen estados pasados. Clientes sin suscripciones no se consideran perdidos.
              </p>
              <Series
                rows={data.clientes.serie}
                columns={[{ key: 'altas', label: 'Altas de clientes', color: '#77baff' }]}
              />
              {section === 'clientes' && (
                <div className="k13-table-scroll">
                  <table>
                    <caption>
                      Hasta 10 productos con más clientes vigentes. Un cliente puede aparecer en
                      varios productos.
                    </caption>
                    <thead>
                      <tr>
                        <th>Producto actual</th>
                        <th>Clientes con servicio ahora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.clientes.productosActuales.map((r) => (
                        <tr key={r.id}>
                          <td>{r.nombre}</td>
                          <td>{r.clientes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {data.renovaciones && (
            <section className="k13-panel" aria-label="Análisis de renovaciones">
              <div className="k13-panel-heading">
                <h2>Renovaciones por cliente</h2>
              </div>
              <div className="stats-metrics">
                <Metric
                  label="Tasa de renovación por cliente"
                  value={
                    data.renovaciones.tasa.porcentaje === null
                      ? 'No disponible'
                      : data.renovaciones.tasa.porcentaje + ' %'
                  }
                  note={`${data.renovaciones.tasa.renovados} de ${data.renovaciones.tasa.clientes} clientes con vencimientos registrados`}
                />
                <Metric
                  label="Renovaciones realizadas"
                  value={data.renovaciones.realizadas}
                  note="Operaciones del periodo"
                />
                <Metric label="Altas registradas" value={data.renovaciones.altas} />
                <Metric label="Operaciones anuladas" value={data.renovaciones.anuladas} />
                <Metric label="Operaciones gratuitas" value={data.renovaciones.gratuitas} />
                <Metric label="Operaciones por cobrar" value={data.renovaciones.pendientesCobro} />
              </div>
              <p className="stats-note">
                Cada cliente cuenta una vez: basta renovar uno de sus servicios que vencían en el
                periodo. Se incluyen renovaciones anticipadas o posteriores al vencimiento,
                gratuitas o pendientes de cobro, observadas hasta hoy. ALTA y anulaciones no
                renuevan. El filtro de estado no cambia la base de la tasa.
              </p>
              {data.renovaciones.tasa.provisional && (
                <p className="stats-note">
                  Periodo abierto: la tasa es provisional y puede cambiar con nuevas renovaciones.
                </p>
              )}
              {data.renovaciones.tasa.sinVencimientoAnterior > 0 && (
                <p role="status" className="stats-warning">
                  Cobertura incompleta: {data.renovaciones.tasa.sinVencimientoAnterior} renovaciones
                  sin vencimiento anterior verificable. No se muestra una tasa definitiva.
                </p>
              )}
              <Series
                rows={data.renovaciones.serie}
                columns={[
                  { key: 'renovaciones', label: 'Renovaciones completadas', color: '#ffb459' },
                ]}
              />
              <p className="stats-note">
                Ahora: {data.renovaciones.situacionActual.vencidas} vencidas,{' '}
                {data.renovaciones.situacionActual.hoy} hoy y{' '}
                {data.renovaciones.situacionActual.proximas} en los próximos{' '}
                {data.renovaciones.situacionActual.diasAviso} días. No incluye servicios marcados No
                renovar.
              </p>
            </section>
          )}
          {data.ranking && (
            <section className="k13-panel" aria-label="Desglose estadístico">
              <div className="k13-panel-heading">
                <h2>
                  {data.ranking.dimension === 'categorias'
                    ? 'Gastos por categoría'
                    : sections[section]}{' '}
                  · Desglose
                </h2>
                <strong>{money(data.ranking.totalImporte)}</strong>
              </div>
              <p className="stats-note">
                Importes del periodo; clientes actuales independientes de fechas. Los clientes por
                grupo no son sumables. No se reparte el gasto general ni se calcula beneficio por
                producto, servidor o referencia. Los importes sin atribución verificable se
                mantienen en el total.
              </p>
              <Bars rows={data.ranking.grafico} />
              <div className="k13-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Importe</th>
                      <th>% del total</th>
                      <th>Movimientos</th>
                      {dimension && (
                        <>
                          <th>Renovaciones</th>
                          <th>Clientes con cobros</th>
                          <th>Clientes vigentes ahora</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.ranking.data.map((r) => (
                      <tr key={r.clave}>
                        <td>{r.nombre}</td>
                        <td>{money(r.importe)}</td>
                        <td>{r.porcentaje === null ? '—' : r.porcentaje + ' %'}</td>
                        <td>{r.operaciones}</td>
                        {dimension && (
                          <>
                            <td>{r.renovaciones}</td>
                            <td>{r.clientesCobro}</td>
                            <td>{r.clientesActuales}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.ranking.data.length && (
                <p className="k13-empty">No hay datos para estos filtros.</p>
              )}
              <div className="k13-pagination">
                <span>
                  {data.ranking.pagination.total} grupos · Página {page} de{' '}
                  {Math.max(1, data.ranking.pagination.totalPages)}
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
                    disabled={page >= data.ranking.pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </section>
          )}
          <p className="k13-period-note">
            Solo datos registrados: no es necesario importar el XLSX.{' '}
            {data.calidad.filasSinConciliar} filas de staging sin conciliar, excluidas del análisis
            económico. Última consulta:{' '}
            {new Date(data.actualizado).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' })}.
            Refresco cada minuto.
          </p>
        </>
      )}
    </div>
  );
}

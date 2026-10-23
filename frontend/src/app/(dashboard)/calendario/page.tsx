'use client';
import { useConfiguredPage } from '@/modules/configuracion/preferences';
import { useDateLabel, useRefreshInterval } from '@/modules/configuracion/preferences';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { reminders, madridToday, kindLabel } from '@/modules/recordatorios/recordatorios.service';
import { Failure, Pager } from '@/modules/recordatorios/reminders-ui';
import { usePageBounds } from '@/modules/recordatorios/use-page-bounds';

const iso = (date: Date) => date.toISOString().slice(0, 10);
export default function CalendarPage() {
  const dateLabel = useDateLabel();
  const refreshInterval = useRefreshInterval();

  const [month, setMonth] = useState(() => madridToday().slice(0, 7)),
    [day, setDay] = useState(madridToday),
    [page, setPage, pageLimit] = useConfiguredPage(),
    [tipo, setTipo] = useState('');
  const first = new Date(month + '-01T00:00:00Z');
  const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86400000);
  const days = Array.from({ length: 42 }, (_, i) => iso(new Date(start.getTime() + i * 86400000)));
  const params = { desde: days[0], hasta: days[41], tipo: tipo || undefined };
  const calendar = useQuery({
    queryKey: ['recordatorios', 'calendar', params],
    queryFn: () => reminders.calendar(params),
    staleTime: 0,
    refetchInterval: refreshInterval,
  });
  const agendaParams = { desde: day, hasta: day, tipo: tipo || undefined, page, limit: pageLimit };
  const agenda = useQuery({
    queryKey: ['recordatorios', 'agenda', agendaParams],
    queryFn: () => reminders.agenda(agendaParams),
    staleTime: 0,
    refetchInterval: refreshInterval,
  });
  const adjusting = usePageBounds(
    page,
    setPage,
    agenda.data?.pagination,
    !agenda.isFetching && !agenda.isError,
  );
  const move = (offset: number) => {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + offset);
    const value = iso(d);
    setMonth(value.slice(0, 7));
    setDay(value);
    setPage(1);
  };
  return (
    <div className="reminders">
      <header className="rem-heading">
        <div>
          <h1>Calendario</h1>
          <p>Renovaciones, cobros pendientes y tareas de clientes · Europe/Madrid</p>
        </div>
        <Link href="/recordatorios">Gestionar recordatorios</Link>
      </header>
      <section className="k13-panel rem-section">
        <div className="rem-filters">
          <button onClick={() => move(-1)}>Mes anterior</button>
          <h2>
            {first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </h2>
          <button onClick={() => move(1)}>Mes siguiente</button>
          <button
            onClick={() => {
              const today = madridToday();
              setMonth(today.slice(0, 7));
              setDay(today);
              setPage(1);
            }}
          >
            Hoy
          </button>
          <label>
            Tipo
            <select
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="RENOVACION">Renovaciones</option>
              <option value="COBRO">Cobros</option>
              <option value="TELEGRAM">Contacto interno</option>
            </select>
          </label>
        </div>
        <p>
          Los avisos pospuestos se muestran en su nueva fecha de seguimiento; el vencimiento
          original no cambia. Cerrar un aviso no elimina la obligación de renovar o cobrar.
        </p>
        {calendar.isPending && <p role="status">Cargando calendario…</p>}
        {calendar.isError && (
          <>
            <Failure error={calendar.error} />
            <button onClick={() => void calendar.refetch()}>Reintentar calendario</button>
          </>
        )}
        <div className="rem-calendar">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <span key={d}>{d}</span>
          ))}
          {days.map((d) => {
            const count = calendar.isError ? undefined : calendar.data?.find((r) => r.fecha === d);
            return (
              <button
                key={d}
                className={d.startsWith(month) ? '' : 'outside'}
                aria-pressed={day === d}
                aria-label={`${dateLabel(d)}${count ? ': ' + count.total + ' eventos' : ''}`}
                onClick={() => {
                  setDay(d);
                  setPage(1);
                }}
              >
                <span>{Number(d.slice(-2))}</span>
                {count && <small>{count.total} eventos</small>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="k13-panel rem-section">
        <h2>Agenda · {dateLabel(day)}</h2>
        <label>
          Ir al día
          <input
            type="date"
            value={day}
            onChange={(e) => {
              if (!e.target.value) return;
              setDay(e.target.value);
              setMonth(e.target.value.slice(0, 7));
              setPage(1);
            }}
          />
        </label>
        {(agenda.isPending || adjusting) && <p role="status">Cargando agenda…</p>}
        {agenda.isError && (
          <>
            <Failure error={agenda.error} />
            <button onClick={() => void agenda.refetch()}>Reintentar agenda</button>
          </>
        )}
        {!agenda.isError && !adjusting && agenda.data && (
          <>
            {!agenda.data.data.length && <p>No hay eventos para este día.</p>}
            {agenda.data.data.map((r) => (
              <article className="rem-agenda" key={r.clave}>
                <h3>
                  <Link href={'/clientes/' + r.clienteId}>{r.cliente}</Link> · {kindLabel(r.tipo)}
                </h3>
                <p>{r.descripcion}</p>
                <p>
                  Fecha original: {dateLabel(r.fechaOriginal)}
                  {r.estadoAviso && ' · Aviso: ' + r.estadoAviso}
                </p>
                <div className="rem-links">
                  {r.recordatorioId && (
                    <Link href={'/recordatorios/' + r.recordatorioId}>Gestionar aviso</Link>
                  )}
                  {r.renovacionId ? (
                    <Link href={'/renovaciones/' + r.renovacionId}>Ver cobro</Link>
                  ) : (
                    r.suscripcionId && (
                      <Link href={'/suscripciones/' + r.suscripcionId}>Ver suscripción</Link>
                    )
                  )}
                </div>
              </article>
            ))}
            <Pager page={page} totalPages={agenda.data.pagination.totalPages} setPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}

'use client';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { money } from '@/modules/renovaciones/renovaciones.service';
import type { DashboardData } from './dashboard.service';
export function Sparkline({
  values,
  color = 'currentColor',
}: {
  values: number[];
  color?: string;
}) {
  const low = Math.min(0, ...values),
    high = Math.max(1, ...values),
    range = high - low || 1;
  const points = values
    .map(
      (value, i) =>
        `${4 + (i * 232) / Math.max(1, values.length - 1)},${45 - ((value - low) * 40) / range}`,
    )
    .join(' ');
  return (
    <svg viewBox="0 0 240 50" preserveAspectRatio="none" className="k13-spark" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export function Kpi({
  title,
  value,
  tone,
  icon: Icon,
  caption,
  change,
  series,
  href,
}: {
  title: string;
  value: string | number;
  tone: string;
  icon: LucideIcon;
  caption: string;
  change?: string | null;
  series?: number[];
  href: string;
}) {
  return (
    <Link href={href} className={'k13-kpi ' + tone}>
      <div className="k13-kpi-top">
        <span className="k13-kpi-icon">
          <Icon size={25} />
        </span>
        <div>
          <h2>{title}</h2>
          <strong>{value}</strong>
        </div>
      </div>
      <p className="k13-kpi-caption">
        {change !== undefined &&
          (change === null ? (
            <span>Sin base de comparación · </span>
          ) : (
            <span className="k13-change">
              {Number(change) >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {Number(change) > 0 ? '+' : ''}
              {change}% ·{' '}
            </span>
          ))}
        {caption}
      </p>
      {series ? (
        <Sparkline values={series} />
      ) : (
        <span className="k13-kpi-current">
          Situación actual <ArrowUpRight size={18} />
        </span>
      )}
    </Link>
  );
}
export function FinanceChart({ rows }: { rows: DashboardData['serie'] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.ingresos), Number(r.gastos)]));
  const path = (key: 'ingresos' | 'gastos') =>
    rows
      .map(
        (r, i) =>
          `${24 + (i * 652) / Math.max(1, rows.length - 1)},${174 - (Number(r[key]) * 150) / max}`,
      )
      .join(' ');
  return (
    <>
      <div className="k13-chart-legend">
        <span>● Ingresos brutos</span>
        <span>┄ Gastos pagados</span>
      </div>
      <svg
        className="k13-chart"
        viewBox="0 0 700 205"
        role="img"
        aria-label="Evolución de ingresos confirmados y gastos pagados. Datos exactos disponibles debajo."
      >
        {[24, 74, 124, 174].map((y) => (
          <line key={y} x1="24" x2="676" y1={y} y2={y} stroke="#ffffff12" />
        ))}
        <text x="24" y="16" fill="#afbed0" fontSize="10">
          {money(max)}
        </text>
        <polyline points={path('ingresos')} fill="none" stroke="#20dfb0" strokeWidth="2.5" />
        {rows.length === 1 && (
          <>
            <circle
              cx="24"
              cy={174 - (Number(rows[0].ingresos) * 150) / max}
              r="4"
              fill="#20dfb0"
            />
            <circle cx="24" cy={174 - (Number(rows[0].gastos) * 150) / max} r="3" fill="#ffb65b" />
          </>
        )}
        <polyline
          points={path('gastos')}
          fill="none"
          stroke="#ffb65b"
          strokeWidth="2.5"
          strokeDasharray="5 3"
        />
        <text x="24" y="197" fill="#afbed0" fontSize="11">
          {rows[0]?.dia}
        </text>
        <text x="676" y="197" textAnchor="end" fill="#afbed0" fontSize="11">
          {rows.at(-1)?.dia}
        </text>
      </svg>
      <details className="k13-series-details">
        <summary>Ver datos diarios</summary>
        <div className="k13-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ingresos</th>
                <th>Gastos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dia}>
                  <td>{row.dia}</td>
                  <td>{money(row.ingresos)}</td>
                  <td>{money(row.gastos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

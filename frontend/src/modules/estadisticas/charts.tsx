'use client';
import { money } from '@/modules/renovaciones/renovaciones.service';
export function Series({
  rows,
  columns,
}: {
  rows: Record<string, string | number | null>[];
  columns: { key: string; label: string; color: string; currency?: boolean }[];
}) {
  const values = rows.flatMap((r) => columns.map((c) => Number(r[c.key] ?? 0))),
    min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const point = (r: Record<string, string | number | null>, i: number, key: string) => [
    30 + (i * 640) / Math.max(1, rows.length - 1),
    175 - ((Number(r[key] ?? 0) - min) * 150) / span,
  ];
  return (
    <>
      <div className="stats-legend">
        {columns.map((c) => (
          <span key={c.key} style={{ color: c.color }}>
            {c.label}
          </span>
        ))}
      </div>
      <svg
        viewBox="0 0 700 210"
        className="k13-chart"
        role="img"
        aria-label="Evolución del periodo. Valores exactos en la tabla inferior."
      >
        {[25, 75, 125, 175].map((y) => (
          <line key={y} x1="30" x2="670" y1={y} y2={y} stroke="#ffffff18" />
        ))}
        <text x="30" y="16" fill="#bac8db" fontSize="10">
          {columns.some((c) => c.currency) ? money(max) : max}
        </text>
        {columns.map((c, index) => (
          <g key={c.key}>
            {rows.length === 1 ? (
              <circle
                cx={point(rows[0], 0, c.key)[0]}
                cy={point(rows[0], 0, c.key)[1]}
                r={5 - index}
                fill={c.color}
              />
            ) : (
              <polyline
                points={rows.map((r, i) => point(r, i, c.key).join(',')).join(' ')}
                fill="none"
                stroke={c.color}
                strokeWidth="2.5"
                strokeDasharray={index ? '6 3' : undefined}
              />
            )}
          </g>
        ))}
        <text x="30" y="202" fill="#bac8db" fontSize="11">
          {rows[0]?.dia}
        </text>
        <text x="670" y="202" textAnchor="end" fill="#bac8db" fontSize="11">
          {rows.at(-1)?.dia}
        </text>
      </svg>
      <details className="k13-series-details">
        <summary>Ver datos exactos</summary>
        <div className="k13-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.dia)}>
                  <td>{r.dia}</td>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {r[c.key] === null
                        ? 'No aplicable'
                        : c.currency
                          ? money(r[c.key] ?? 0)
                          : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function Bars({ rows }: { rows: { clave: string; nombre: string; importe: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.importe)));
  return (
    <div className="stats-bars" aria-label="Distribución de importes">
      {rows.map((r) => (
        <div key={r.clave}>
          <div>
            <span>{r.nombre}</span>
            <strong>{money(r.importe)}</strong>
          </div>
          <div className="stats-track">
            <span style={{ width: (Number(r.importe) * 100) / max + '%' }} />
          </div>
        </div>
      ))}
      {!rows.length && <p className="k13-empty">Sin importes confirmados en este periodo.</p>}
    </div>
  );
}

import { dashboardPeriod, variation } from './dashboard.service';
describe('Periodos y variaciones del dashboard', () => {
  it('compara ventanas consecutivas de igual longitud, incluso en año bisiesto', () => {
    expect(dashboardPeriod({ desde: '2024-03-01', hasta: '2024-03-02' })).toEqual({
      desde: '2024-03-01',
      hasta: '2024-03-02',
      anteriorDesde: '2024-02-28',
      anteriorHasta: '2024-02-29',
      days: 2,
    });
    expect(dashboardPeriod({}, '2026-09-25').days).toBe(25);
  });
  it('rechaza fechas imposibles, parciales y periodos ilimitados', () => {
    for (const query of [
      { desde: '2026-09-01' },
      { desde: '2026-02-30', hasta: '2026-03-01' },
      { desde: '2026-03-02', hasta: '2026-03-01' },
      { desde: '2025-01-01', hasta: '2026-09-01' },
    ])
      expect(() => dashboardPeriod(query)).toThrow();
  });
  it('no inventa comparación con base cero; conserva signo y precisión', () => {
    expect(variation(10, 0)).toBeNull();
    expect(variation(0, 0)).toBeNull();
    expect(variation('0.30', '0.20')).toBe('50.0');
    expect(variation('-10', '-20')).toBe('50.0');
    expect(variation(0, 20)).toBe('-100.0');
  });
});

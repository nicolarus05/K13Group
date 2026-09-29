import { buckets, statsPeriod, StatsQuery, validateFilters } from './estadisticas.dto';

const query = (desde: string, hasta: string, agrupacion: StatsQuery['agrupacion'] = 'mes') =>
  Object.assign(new StatsQuery(), { desde, hasta, agrupacion });
describe('Periodos estadísticos', () => {
  it('usa el mes actual y una comparación contigua de igual longitud', () => {
    expect(statsPeriod(new StatsQuery(), '2026-09-28')).toMatchObject({
      desde: '2026-09-01',
      hasta: '2026-09-28',
      dias: 28,
      anteriorDesde: '2026-08-04',
      anteriorHasta: '2026-08-31',
    });
  });
  it('conserva días civiles en año bisiesto y cambios de horario', () => {
    expect(statsPeriod(query('2024-01-01', '2024-12-31', 'dia')).dias).toBe(366);
    expect(buckets('2026-03-28', '2026-03-30', 'dia')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    expect(buckets('2026-10-24', '2026-10-26', 'dia')).toHaveLength(3);
  });
  it('rechaza fechas incompletas, imposibles, invertidas y detalle diario excesivo', () => {
    for (const q of [
      Object.assign(new StatsQuery(), { desde: '2026-01-01' }),
      query('2026-02-30', '2026-03-01'),
      query('2026-09-02', '2026-09-01'),
      query('2024-01-01', '2025-01-01', 'dia'),
    ])
      expect(() => statsPeriod(q)).toThrow();
  });
  it('limita a cinco años sin truncar el informe silenciosamente', () => {
    expect(buckets('2022-01-01', '2026-12-31', 'mes')).toHaveLength(60);
    expect(statsPeriod(query('2022-01-01', '2026-12-31')).dias).toBe(1826);
    expect(() => statsPeriod(query('2022-01-01', '2027-01-01'))).toThrow();
    expect(buckets('2025-09-20', '2026-09-28', 'ano')).toEqual(['2025-01-01', '2026-01-01']);
  });
  it('solo permite filtros con significado para la métrica solicitada', () => {
    expect(() =>
      validateFilters('resumen', Object.assign(new StatsQuery(), { productoId: 'id' })),
    ).toThrow();
    expect(() =>
      validateFilters(
        'finanzas',
        Object.assign(new StatsQuery(), { metodoPagoId: 'id', categoriaGastoId: 'id' }),
      ),
    ).toThrow();
    expect(() =>
      validateFilters('clientes', Object.assign(new StatsQuery(), { estadoCliente: 'INACTIVO' })),
    ).not.toThrow();
  });
});

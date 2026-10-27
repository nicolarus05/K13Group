import { annualEnd, businessDay, datedState, parseDay } from './subscription-dates';
describe('Fechas anuales y día de negocio', () => {
  it('limita el 29 de febrero al último día de febrero siguiente', () => {
    expect(annualEnd(parseDay('2024-02-29')).toISOString().slice(0, 10)).toBe('2025-02-28');
    expect(annualEnd(parseDay('2026-09-15')).toISOString().slice(0, 10)).toBe('2027-09-15');
  });
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', 'no', '0000-01-01'])('rechaza %s', (value) => {
    expect(() => parseDay(value)).toThrow();
  });
  it('respeta el cambio de día en Madrid en verano e invierno', () => {
    expect(businessDay(new Date('2026-09-22T22:30:00Z'))).toBe('2026-09-23');
    expect(businessDay(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
  it.each([
    ['2026-03-28T23:30:00Z', '2026-03-29'],
    ['2026-03-29T00:59:59Z', '2026-03-29'],
    ['2026-03-29T01:00:00Z', '2026-03-29'],
    ['2026-03-29T22:00:00Z', '2026-03-30'],
    ['2026-10-25T00:59:59Z', '2026-10-25'],
    ['2026-10-25T01:00:00Z', '2026-10-25'],
    ['2026-10-25T22:30:00Z', '2026-10-25'],
    ['2026-10-25T23:00:00Z', '2026-10-26'],
  ])('mantiene el día de negocio durante el cambio horario: %s', (instant, expected) => {
    expect(businessDay(new Date(instant))).toBe(expected);
    expect(datedState(parseDay(expected), businessDay(new Date(instant)))).toBe('VENCIDA');
  });
  it('vence el mismo día y avisa dentro del intervalo inclusivo de siete días', () => {
    expect(datedState(parseDay('2026-09-23'), '2026-09-23')).toBe('VENCIDA');
    expect(datedState(parseDay('2026-09-30'), '2026-09-23')).toBe('PROXIMA_A_VENCER');
    expect(datedState(parseDay('2026-10-01'), '2026-09-23')).toBe('ACTIVA');
  });
});

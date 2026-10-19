import { annualStart, equivalenceSource } from './equivalence-rules';

describe('Reglas de equivalencias 12.3', () => {
  it('restaurar un valor no rehabilita una decisión invalidada; otros campos no la invalidan', () => {
    const row = {
      lectura: { campos: { APP: { valor: 'MAXPLAYER' } } },
      correcciones: null,
      datosNormalizados: { productoClave: 'MAXPLAYER' },
    };
    const original = equivalenceSource(row, 'PRODUCTO');
    const unrelated = equivalenceSource(
      { ...row, historialLectura: [{ version: 2, cambios: { FECHA: '2026-10-20' } }] },
      'PRODUCTO',
    );
    const restored = equivalenceSource(
      {
        ...row,
        historialLectura: [
          { version: 2, cambios: { APP: 'K13PLAYER' } },
          { version: 3, cambios: { APP: 'MAXPLAYER' } },
        ],
      },
      'PRODUCTO',
    );
    expect(unrelated.dependencia).toBe(original.dependencia);
    expect(restored.clave).toBe(original.clave);
    expect(restored.dependencia).not.toBe(original.dependencia);
  });
  it.each([
    ['2024-02-29', '2023-02-28'],
    ['2026-03-31', '2025-03-31'],
    ['2025-02-28', '2024-02-28'],
    ['2026-02-30', null],
    ['1900-01-01', null],
    ['', null],
  ])('resta un año natural a %s', (date, result) => {
    expect(annualStart(date)).toBe(result);
  });
  it('no pierde APP desconocidas ni expone identificadores operativos', () => {
    const row = {
      lectura: { campos: { APP: { valor: 'APP secreta AA:BB:CC:DD:EE:FF', celda: 'B2' } } },
      correcciones: null,
      datosNormalizados: { productoClave: null },
    };
    const source = equivalenceSource(row, 'PRODUCTO');
    expect(source.ausente).toBe(false);
    expect(source.etiqueta).toMatch(/APP no reconocida/);
    expect(JSON.stringify(source)).not.toMatch(/AA:BB|APP secreta/);
    expect(equivalenceSource({ ...row, correcciones: { APP: null } }, 'PRODUCTO').ausente).toBe(
      true,
    );
  });
  it('PA no admite equivalencias y la tarifa depende del producto y su versión', () => {
    const row = {
      lectura: { campos: { PAGO: { valor: ' pa ' }, PANO: { valor: 75 } } },
      correcciones: null,
      datosNormalizados: { importeAnual: 75 },
    };
    expect(equivalenceSource(row, 'PAGO').ignorado).toBe(true);
    const a = equivalenceSource(row, 'TARIFA', { id: 'a', huella: 'v1' });
    const b = equivalenceSource(row, 'TARIFA', { id: 'b', huella: 'v1' });
    const c = equivalenceSource(row, 'TARIFA', { id: 'a', huella: 'v2' });
    expect(a.clave).not.toBe(b.clave);
    expect(a.dependencia).not.toBe(c.dependencia);
  });
});

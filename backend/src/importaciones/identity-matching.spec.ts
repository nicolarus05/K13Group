import { identityData, identityMatch, identityPhone, identityProblems } from './identity-matching';

describe('Propuestas de identidad', () => {
  const data = (nombre: string, telefono: string | null = null) => ({
    nombre,
    telefono,
    email: null,
    observaciones: null,
  });
  it('normaliza formato sin inventar prefijo ni teléfono', () => {
    expect(identityPhone('0034 612 345 678')).toBe('34612345678');
    expect(identityPhone('612345678')).toBe('612345678');
    expect(identityPhone('612345678 / 699999999')).toBeNull();
    expect(identityPhone(null)).toBeNull();
  });
  it('explica coincidencias y conflictos sin decidir una vinculación', () => {
    expect(
      identityMatch(data('José López', '+34612345678'), data('JOSE LOPEZ', '0034612345678')),
    ).toBe('Mismo teléfono y nombre compatible');
    expect(identityMatch(data('José López', '612345678'), data('Ana López', '612345678'))).toMatch(
      /Conflicto/,
    );
    expect(identityMatch(data('José López', '612345678'), data('José López', '612345679'))).toMatch(
      /Conflicto/,
    );
    expect(identityMatch(data('José López'), data('Jose Lopez'))).toMatch(/falta teléfono/);
    expect(identityMatch(data('José López'), data('Jose Lope'))).toMatch(/parecidos/);
    expect(identityMatch(data(''), data(''))).toBeNull();
    expect(identityMatch(data('Ana'), data('Eva'))).toBeNull();
  });
  it('no exporta datos operativos y permite opcionales nulos con nombre válido', () => {
    expect(identityData({ nombre: ' Prueba ', APP: 'privado', telefono: null })).toEqual(
      data('Prueba'),
    );
    expect(identityProblems(data('Prueba'))).toEqual([]);
    expect(identityProblems(data('---'))).toHaveLength(1);
    expect(identityProblems({ ...data('Prueba', 'abc'), email: 'correo inválido' })).toHaveLength(
      2,
    );
  });
  it('señala emails contradictorios aunque el nombre y el teléfono coincidan', () => {
    expect(
      identityMatch(
        { ...data('Prueba', '612345678'), email: 'a@example.test' },
        { ...data('Prueba', '612345678'), email: 'b@example.test' },
      ),
    ).toMatch(/emails distintos/);
  });
});

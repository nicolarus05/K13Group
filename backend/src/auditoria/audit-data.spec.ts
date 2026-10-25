import { auditChanges, safeAuditData } from './audit-data';

describe('Contrato de datos de auditoría', () => {
  it('no interpreta una instantánea parcial como campos eliminados', () => {
    expect(auditChanges({ nombre: 'Ana', email: 'a@example.test' }, { nombre: 'Bea' })).toEqual([
      { campo: 'nombre', anterior: 'Ana', nuevo: 'Bea' },
    ]);
    expect(auditChanges({ nombre: 'Ana' }, { nombre: null })).toEqual([
      { campo: 'nombre', anterior: 'Ana', nuevo: null },
    ]);
  });
  it('compara el sobre histórico de ajustes con sus valores anteriores', () => {
    expect(
      auditChanges(
        { 'negocio.nombre': 'Antes', otro: 1 },
        { cambios: { 'negocio.nombre': 'Después' }, motivo: 'Cambio' },
      ),
    ).toEqual([{ campo: 'negocio.nombre', anterior: 'Antes', nuevo: 'Después' }]);
  });
  it('conserva el motivo y los vínculos pero oculta secretos y originales sin modificar la entrada', () => {
    const value = {
      motivo: 'Revisado',
      loteId: 'lote',
      nested: [
        {
          password_hash: 'secret',
          authorization: 'Bearer test',
          identificador_operativo_hash: 'hash',
        },
      ],
      datosOriginales: { APP: 'dato privado' },
    };
    expect(JSON.stringify(safeAuditData(value))).not.toMatch(/secret|Bearer test|dato privado/);
    expect(safeAuditData(value)).toMatchObject({ motivo: 'Revisado', loteId: 'lote' });
    expect(value.nested[0].password_hash).toBe('secret');
  });
  it('el histórico sin instantáneas no tiene comparación reconstruida', () => {
    expect(auditChanges(null, { nombre: 'Ana' })).toBeNull();
    expect(auditChanges({ nombre: 'Ana' }, null)).toBeNull();
  });
});

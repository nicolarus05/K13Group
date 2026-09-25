import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { seedBase } from '../../prisma/seed';
import { PrismaService } from '../database/prisma.service';
import { ClientesService } from '../clientes/clientes.service';
import { SuscripcionesService } from './suscripciones.service';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';

const isolated = process.env.TEST_DATABASE_URL;
const suite = isolated && process.env.SUBSCRIPTIONS_LOAD_TEST === '1' ? describe : describe.skip;
suite('Regresión de carga: 10.000 estados pendientes', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    if (
      !isolated ||
      !/^catalogos_test_[a-f0-9]{32}$/.test(new URL(isolated).searchParams.get('schema') ?? '')
    )
      throw new Error('La prueba de carga requiere un esquema temporal.');
    db = new PrismaClient({ datasourceUrl: isolated });
    await seedBase(db);
  }, 30000);
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('permite leer clientes durante el recálculo y confirma todos los lotes sin duplicar auditoría', async () => {
    const service = new SuscripcionesService(
      db as PrismaService,
      new RecordatoriosService(db as PrismaService),
    );
    const clients = new ClientesService(db as PrismaService, service);
    await service.syncStates();
    const active = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'suscripcion', valor: 'ACTIVA' } },
    });
    const clientState = await db.estado.findUniqueOrThrow({
      where: { tipo_valor: { tipo: 'cliente', valor: 'ACTIVO' } },
    });
    const client = await db.cliente.create({
      data: { nombre: 'Carga ficticia ' + randomUUID(), estadoId: clientState.id },
    });
    const rate = await db.tarifa.findFirstOrThrow({
      where: { activo: true, producto: { activo: true } },
    });
    const server = await db.servidor.findFirstOrThrow({ where: { activo: true } });
    await db.suscripcion.createMany({
      data: Array.from({ length: 10000 }, () => ({
        clienteId: client.id,
        productoId: rate.productoId,
        tarifaId: rate.id,
        servidorId: server.id,
        estadoId: active.id,
        fechaInicio: new Date('2020-01-01'),
        fechaFin: new Date('2021-01-01'),
      })),
    });
    const sync = jest.spyOn(service, 'syncStates');
    const started = Date.now();
    const work = service.syncStates();
    try {
      const readStart = Date.now();
      const read = await clients.findOne(client.id);
      const readMs = Date.now() - readStart;
      expect(read.suscripciones).toHaveLength(10000);
      expect(read.suscripciones.every((row) => row.estado.valor === 'VENCIDA')).toBe(true);
      expect(sync).toHaveBeenCalledTimes(1); // La lectura no inicia otro barrido.
      expect(await work).toBe(10000);
      const where = { clienteId: client.id, estado: { valor: 'VENCIDA' }, version: 2 };
      expect(await db.suscripcion.count({ where })).toBe(10000);
      const records = await db.suscripcion.findMany({ where, select: { id: true } });
      expect(
        await db.actividad.count({
          where: { registroId: { in: records.map((row) => row.id) }, accion: 'ESTADO_AUTOMATICO' },
        }),
      ).toBe(10000);
      expect(await service.syncStates()).toBe(0);
      console.log(
        JSON.stringify({
          prueba: '10000 suscripciones',
          lecturaMs: readMs,
          totalMs: Date.now() - started,
        }),
      );
    } finally {
      await work;
      sync.mockRestore();
    }
  }, 120000);
});

import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AplicacionService } from './aplicacion.service';
import { EquivalenciasRevisionService } from './equivalencias-revision.service';
import { IdentidadesService } from './identidades.service';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';

// Test the HTTP boundary without opening a connection to the business database.
describe('Validación HTTP de identificadores de importación', () => {
  let app: INestApplication;
  const id = '51655431-5d9d-4426-9a9b-b23348620d59';
  const rowId = 'a7ff8211-2d9a-4133-b41d-fae710b73acb';
  const service = {
    confirm: jest.fn().mockResolvedValue({ id }),
    reconcile: jest.fn().mockResolvedValue({ id }),
    getImportacion: jest.fn().mockResolvedValue({ id }),
    getFilas: jest.fn().mockResolvedValue({ data: [] }),
    getCatalogos: jest.fn().mockResolvedValue({}),
    getPendingValues: jest.fn().mockResolvedValue({}),
    saveEquivalence: jest.fn().mockResolvedValue({ id }),
    reviewRow: jest.fn().mockResolvedValue({ id: rowId }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ImportacionesController],
      providers: [
        { provide: ImportacionesService, useValue: service },
        { provide: AplicacionService, useValue: {} },
        { provide: IdentidadesService, useValue: {} },
        { provide: EquivalenciasRevisionService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<{ user: { id: string } }>().user = { id };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });

  const cases: Array<{
    method: 'get' | 'post' | 'patch';
    suffix: string;
    body: Record<string, unknown>;
  }> = [
    { method: 'post', suffix: '/confirmar', body: { confirmar: true } },
    { method: 'post', suffix: '/reconciliar', body: { confirmarOperaciones: true } },
    { method: 'get', suffix: '', body: {} },
    { method: 'get', suffix: '/filas', body: {} },
    { method: 'get', suffix: '/errores', body: {} },
    { method: 'get', suffix: '/catalogos', body: {} },
    { method: 'get', suffix: '/valores-pendientes', body: {} },
    {
      method: 'post',
      suffix: '/equivalencias',
      body: {
        tipo: 'PRODUCTO',
        valorOrigen: 'Aplicación',
        valorClave: 'APLICACION',
        valorCanonico: 'Aplicación',
      },
    },
    { method: 'patch', suffix: `/filas/${rowId}/revisar`, body: { decision: 'PENDIENTE' } },
  ];

  it.each(cases)('rechaza id inválido en $method :id$suffix antes del servicio', async (test) => {
    await request(app.getHttpServer())
      [test.method]('/importaciones/no-es-un-uuid' + test.suffix)
      .set('Idempotency-Key', id)
      .send(test.body)
      .expect(400);
    for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
  });

  it('rechaza filaId inválido aunque el identificador de importación sea válido', async () => {
    await request(app.getHttpServer())
      .patch(`/importaciones/${id}/filas/no-es-un-uuid/revisar`)
      .send({ decision: 'PENDIENTE' })
      .expect(400);
    expect(service.reviewRow).not.toHaveBeenCalled();
  });

  it('conserva la consulta de una importación con UUID válido', async () => {
    await request(app.getHttpServer())
      .get(`/importaciones/${id}`)
      .expect(200)
      .expect({ success: true, data: { id } });
    expect(service.getImportacion).toHaveBeenCalledWith(id);
  });

  it('conserva la revisión con ambos UUID válidos y su usuario', async () => {
    await request(app.getHttpServer())
      .patch(`/importaciones/${id}/filas/${rowId}/revisar`)
      .send({ decision: 'PENDIENTE' })
      .expect(200);
    expect(service.reviewRow).toHaveBeenCalledWith(
      id,
      rowId,
      id,
      expect.objectContaining({ decision: 'PENDIENTE' }),
    );
  });
});

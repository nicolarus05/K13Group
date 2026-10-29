import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Exercise the HTTP validation boundary without connecting to any database.
describe('Validación HTTP de clientes', () => {
  let app: INestApplication;
  const id = '51655431-5d9d-4426-9a9b-b23348620d59';
  const service = {
    findAll: jest.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
    findOne: jest.fn().mockResolvedValue({ id }),
    create: jest.fn().mockResolvedValue({ id }),
    update: jest.fn().mockResolvedValue({ id }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ClientesController],
      providers: [{ provide: ClientesService, useValue: service }],
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

  it.each(['get', 'put', 'delete'] as const)(
    'rechaza UUID de ruta inválido en %s antes del servicio',
    async (method) => {
      await request(app.getHttpServer())[method]('/clientes/no-es-un-uuid').send({}).expect(400);
      for (const call of Object.values(service)) expect(call).not.toHaveBeenCalled();
    },
  );

  it('rechaza estadoId inválido antes de consultar PostgreSQL', async () => {
    await request(app.getHttpServer()).get('/clientes').query({ estadoId: 'invalido' }).expect(400);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('no permite borrar un nombre obligatorio con null en una edición parcial', async () => {
    await request(app.getHttpServer())
      .put('/clientes/' + id)
      .send({ nombre: null })
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('conserva la edición parcial y el vaciado de los campos opcionales', async () => {
    await request(app.getHttpServer())
      .put('/clientes/' + id)
      .send({ telefono: null, email: null, observaciones: null })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ telefono: null, email: null, observaciones: null }),
      id,
    );
    await request(app.getHttpServer())
      .put('/clientes/' + id)
      .send({ nombre: '  Cliente   de prueba ' })
      .expect(200);
    expect(service.update).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ nombre: 'Cliente de prueba' }),
      id,
    );
  });
});

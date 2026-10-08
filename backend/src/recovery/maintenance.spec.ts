import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Request, Response } from 'express';
import { ExecutionContext } from '@nestjs/common';
import { Subject } from 'rxjs';
import { MaintenanceMiddleware, OperationCompletionInterceptor } from './maintenance';

describe('Mantenimiento con clientes desconectados', () => {
  let root: string;
  let previous: string | undefined;
  beforeEach(async () => {
    previous = process.env.RECOVERY_DIR;
    root = await mkdtemp(join(tmpdir(), 'k13-leases-'));
    process.env.RECOVERY_DIR = root;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.RECOVERY_DIR;
    else process.env.RECOVERY_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const res = Object.assign(new EventEmitter(), {
      locals: {},
      destroyed: false,
    }) as unknown as Response;
    const next = jest.fn();
    await new MaintenanceMiddleware().use(
      { originalUrl: '/api/v1/configuracion', method: 'PATCH' } as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    const context = { switchToHttp: () => ({ getResponse: () => res }) } as ExecutionContext;
    const handler = { handle: jest.fn(() => new Subject()) };
    return { res, context, handler };
  }
  async function expectDrained() {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!(await readdir(join(root, 'leases'))).length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await readdir(join(root, 'leases'))).toHaveLength(0);
  }
  it('libera la reserva al abortar durante un guard y no ejecuta el controlador después', async () => {
    const { res, context, handler } = await fixture();
    res.destroyed = true;
    res.emit('close');
    await expectDrained();
    expect(() => new OperationCompletionInterceptor().intercept(context, handler)).toThrow();
    expect(handler.handle).not.toHaveBeenCalled();
  });
  it('conserva la reserva tras desconectarse hasta finalizar la operación en curso', async () => {
    const { res, context } = await fixture();
    const work = new Subject();
    new OperationCompletionInterceptor().intercept(context, { handle: () => work }).subscribe();
    res.destroyed = true;
    res.emit('close');
    expect(await readdir(join(root, 'leases'))).toHaveLength(1);
    work.complete();
    await expectDrained();
  });
});

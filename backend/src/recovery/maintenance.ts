import {
  Injectable,
  NestMiddleware,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { finalize } from 'rxjs';
import { randomUUID } from 'node:crypto';
export const recoveryRoot = () => process.env.RECOVERY_DIR;
export async function acquireOperation(): Promise<(() => Promise<void>) | null> {
  const root = recoveryRoot();
  if (!root) return async () => {};
  const dir = join(root, 'leases');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, randomUUID());
  await writeFile(file, 'active', { flag: 'wx', mode: 0o600 });
  const release = async () => {
    await unlink(file).catch(() => {});
  };
  try {
    await access(join(root, 'maintenance'));
    await release();
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return release;
    await release();
    throw error;
  }
}
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split('?')[0];
    if (
      req.method === 'OPTIONS' ||
      path.startsWith('/api/docs') ||
      /^\/api\/v1\/configuracion\/trabajos\/[a-f0-9-]+$/.test(path)
    )
      return next();
    try {
      const release = await acquireOperation();
      if (!release)
        return res
          .status(503)
          .json({ message: 'Recuperación en curso. Espera a que termine para continuar.' });
      res.locals.releaseOperation = release;
      // Antes del controlador no hay operación que drenar. Tras iniciarlo, solo
      // su finalización puede liberar la reserva, aunque el cliente se desconecte.
      const abandon = () => {
        res.locals.operationAborted = true;
        if (!res.locals.operationStarted) void release();
      };
      res.once('close', abandon);
      res.once('finish', () => void release());
      if (res.destroyed) {
        abandon();
        return;
      }
      next();
    } catch {
      res.status(503).json({ message: 'No se puede verificar el estado de mantenimiento.' });
    }
  }
}

@Injectable()
export class OperationCompletionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const res = context.switchToHttp().getResponse<Response>();
    if (res.destroyed || res.locals.operationAborted)
      throw new ServiceUnavailableException('La petición se ha desconectado.');
    res.locals.operationStarted = true;
    return next.handle().pipe(
      finalize(() => {
        void res.locals.releaseOperation?.();
      }),
    );
  }
}

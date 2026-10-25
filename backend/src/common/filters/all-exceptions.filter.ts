import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      status >= 500
        ? 'Error interno del servidor'
        : body && typeof body === 'object' && 'message' in body
          ? body.message
          : exception instanceof HttpException
            ? exception.message
            : 'Solicitud no válida';

    const errorId = status >= 500 ? randomUUID() : undefined;
    if (errorId) {
      // Los errores de Prisma pueden contener consultas, parámetros y credenciales.
      // Solo la plantilla de ruta; nunca URL, parámetros, cuerpo ni excepción completa.
      this.logger.error(
        JSON.stringify({
          evento: 'ERROR_HTTP',
          errorId,
          status,
          metodo: request.method,
          ruta: request.route?.path ?? 'desconocida',
        }),
      );
      response.setHeader('X-Request-Id', errorId);
    }

    response.status(status).json({
      success: false,
      message,
      statusCode: status,
      ...(errorId ? { errorId } : {}),
    });
  }
}

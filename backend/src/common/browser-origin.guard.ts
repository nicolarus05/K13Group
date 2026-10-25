import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class BrowserOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin;
    // CORS controla la lectura, no evita que el navegador ejecute una escritura.
    // Clientes CLI sin cabeceras de navegador siguen usando la autenticación normal.
    if (
      origin
        ? origin !== this.config.get('FRONTEND_URL', 'http://localhost:3000')
        : req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new ForbiddenException('Origen de la solicitud no permitido.');
    return true;
  }
}

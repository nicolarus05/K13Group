import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('Errores HTTP sin datos sensibles', () => {
  const fixture = () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          route: { path: '/clientes/:id' },
          originalUrl: '/clientes/123?token=secret-query',
          body: { password: 'secret-body' },
          headers: { authorization: 'secret-header' },
        }),
      }),
    } as unknown as ArgumentsHost;
    return { response, host };
  };
  it('permite correlacionar un fallo sin publicar consultas ni secretos en logs o respuesta', () => {
    const { response, host } = fixture();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      new AllExceptionsFilter().catch(new Error('SQL parameter password=secret-exception'), host);
      const body = response.json.mock.calls[0][0];
      expect(body.statusCode).toBe(500);
      expect(body.errorId).toMatch(/^[a-f0-9-]{36}$/);
      expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', body.errorId);
      const serialized = JSON.stringify([log.mock.calls, body]);
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('SQL');
      expect(serialized).toContain('/clientes/:id');
      expect(serialized).toContain(body.errorId);
    } finally {
      log.mockRestore();
    }
  });
  it('conserva los errores de validación útiles para el formulario', () => {
    const { response, host } = fixture();
    new AllExceptionsFilter().catch(new BadRequestException(['nombre obligatorio']), host);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: ['nombre obligatorio'],
      statusCode: 400,
    });
  });
});

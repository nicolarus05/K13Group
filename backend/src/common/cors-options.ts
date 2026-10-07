import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export const corsOptions = (origin: string): CorsOptions => ({
  origin,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Idempotency-Key'],
});

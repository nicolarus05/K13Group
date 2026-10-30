import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RecoveryModule } from './recovery/recovery.module';
import { MaintenanceMiddleware, OperationCompletionInterceptor } from './recovery/maintenance';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { BrowserOriginGuard } from './common/browser-origin.guard';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientesModule } from './clientes/clientes.module';
import { SuscripcionesModule } from './suscripciones/suscripciones.module';
import { RenovacionesModule } from './renovaciones/renovaciones.module';
import { ProductosModule } from './productos/productos.module';
import { TarifasModule } from './tarifas/tarifas.module';
import { ServidoresModule } from './servidores/servidores.module';
import { ReferenciasModule } from './referencias/referencias.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EstadisticasModule } from './estadisticas/estadisticas.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { RecordatoriosModule } from './recordatorios/recordatorios.module';
import { ImportacionesModule } from './importaciones/importaciones.module';
import { MetodosPagoModule } from './metodos-pago/metodos-pago.module';
import { CategoriasGastoModule } from './categorias-gasto/categorias-gasto.module';
import { ExportacionesModule } from './exportaciones/exportaciones.module';
import { MensajesModule } from './mensajes/mensajes.module';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: BrowserOriginGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationCompletionInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    ClientesModule,
    SuscripcionesModule,
    RenovacionesModule,
    ProductosModule,
    TarifasModule,
    ServidoresModule,
    ReferenciasModule,
    FinanzasModule,
    DashboardModule,
    EstadisticasModule,
    ConfiguracionModule,
    RecoveryModule,
    AuditoriaModule,
    RecordatoriosModule,
    ImportacionesModule,
    MetodosPagoModule,
    CategoriasGastoModule,
    ExportacionesModule,
    MensajesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MaintenanceMiddleware).forRoutes('*path');
  }
}

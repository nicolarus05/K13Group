import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
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
    AuditoriaModule,
    RecordatoriosModule,
  ],
})
export class AppModule {}

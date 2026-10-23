import { Module } from '@nestjs/common';
import { ClientesModule } from '../clientes/clientes.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { RenovacionesModule } from '../renovaciones/renovaciones.module';
import { FinanzasModule } from '../finanzas/finanzas.module';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { ExportacionesController } from './exportaciones.controller';
import { ExportacionesService } from './exportaciones.service';

@Module({
  imports: [
    ClientesModule,
    SuscripcionesModule,
    RenovacionesModule,
    FinanzasModule,
    EstadisticasModule,
  ],
  controllers: [ExportacionesController],
  providers: [ExportacionesService],
})
export class ExportacionesModule {}

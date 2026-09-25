import { Module } from '@nestjs/common';
import { SuscripcionesController } from './suscripciones.controller';
import { SuscripcionesService } from './suscripciones.service';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module';

@Module({
  imports: [RecordatoriosModule],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService],
  exports: [SuscripcionesService],
})
export class SuscripcionesModule {}

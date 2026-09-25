import { Module } from '@nestjs/common';
import { RenovacionesController, SubscriptionRenewalsController } from './renovaciones.controller';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module';
import { RenovacionesService } from './renovaciones.service';

@Module({
  imports: [RecordatoriosModule],
  controllers: [RenovacionesController, SubscriptionRenewalsController],
  providers: [RenovacionesService],
  exports: [RenovacionesService],
})
export class RenovacionesModule {}

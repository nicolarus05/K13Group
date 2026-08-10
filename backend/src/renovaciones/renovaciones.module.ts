import { Module } from '@nestjs/common';
import { RenovacionesController } from './renovaciones.controller';
import { RenovacionesService } from './renovaciones.service';

@Module({
  controllers: [RenovacionesController],
  providers: [RenovacionesService],
  exports: [RenovacionesService],
})
export class RenovacionesModule {}

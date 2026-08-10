import { Module } from '@nestjs/common';
import { ReferenciasController } from './referencias.controller';
import { ReferenciasService } from './referencias.service';

@Module({
  controllers: [ReferenciasController],
  providers: [ReferenciasService],
  exports: [ReferenciasService],
})
export class ReferenciasModule {}

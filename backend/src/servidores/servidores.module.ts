import { Module } from '@nestjs/common';
import { ServidoresController } from './servidores.controller';
import { ServidoresService } from './servidores.service';

@Module({
  controllers: [ServidoresController],
  providers: [ServidoresService],
  exports: [ServidoresService],
})
export class ServidoresModule {}

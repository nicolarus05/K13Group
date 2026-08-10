import { Module } from '@nestjs/common';
import { RecordatoriosController } from './recordatorios.controller';
import { RecordatoriosService } from './recordatorios.service';

@Module({
  controllers: [RecordatoriosController],
  providers: [RecordatoriosService],
  exports: [RecordatoriosService],
})
export class RecordatoriosModule {}

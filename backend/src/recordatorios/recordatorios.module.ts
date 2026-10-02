import { Module } from '@nestjs/common';
import { RecordatoriosController } from './recordatorios.controller';
import { RecordatoriosService } from './recordatorios.service';
import { RecordatoriosGestionService } from './recordatorios-gestion.service';
import { RecordatoriosCalendarioService } from './recordatorios-calendario.service';

@Module({
  controllers: [RecordatoriosController],
  providers: [RecordatoriosService, RecordatoriosGestionService, RecordatoriosCalendarioService],
  exports: [RecordatoriosService],
})
export class RecordatoriosModule {}

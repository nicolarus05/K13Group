import { Module } from '@nestjs/common';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';
import { ExcelParserService } from './excel-parser.service';
import { IdentidadesService } from './identidades.service';

@Module({
  controllers: [ImportacionesController],
  providers: [ImportacionesService, ExcelParserService, IdentidadesService],
  exports: [ImportacionesService],
})
export class ImportacionesModule {}

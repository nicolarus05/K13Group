import { AplicacionService } from './aplicacion.service';
import { Module } from '@nestjs/common';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';
import { ExcelParserService } from './excel-parser.service';
import { IdentidadesService } from './identidades.service';
import { EquivalenciasRevisionService } from './equivalencias-revision.service';

@Module({
  controllers: [ImportacionesController],
  providers: [
    AplicacionService,
    ImportacionesService,
    ExcelParserService,
    IdentidadesService,
    EquivalenciasRevisionService,
  ],
  exports: [ImportacionesService],
})
export class ImportacionesModule {}

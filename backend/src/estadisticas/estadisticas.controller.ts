import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstadisticasService } from './estadisticas.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildResponse } from '../common/helpers/response.helper';
import { SECTIONS, Section, StatsQuery } from './estadisticas.dto';

@ApiTags('estadisticas')
@Controller('estadisticas')
@UseGuards(JwtAuthGuard)
export class EstadisticasController {
  constructor(private readonly estadisticasService: EstadisticasService) {}
  @Get() async summary(@Query() q: StatsQuery) {
    return buildResponse(await this.estadisticasService.report('resumen', q));
  }
  @Get(':seccion') async report(@Param('seccion') section: string, @Query() q: StatsQuery) {
    if (!SECTIONS.includes(section as Section))
      throw new BadRequestException('Informe desconocido.');
    return buildResponse(await this.estadisticasService.report(section as Section, q));
  }
}

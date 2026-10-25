import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditoriaService } from './auditoria.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditoriaQueryDto } from './auditoria.dto';

@ApiTags('auditoria')
@Controller('auditoria')
@UseGuards(JwtAuthGuard)
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: AuditoriaQueryDto) {
    return this.auditoriaService.list(query);
  }
  @Get('filtros')
  @Header('Cache-Control', 'no-store')
  filters() {
    return this.auditoriaService.filters();
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.auditoriaService.detail(id);
  }
}

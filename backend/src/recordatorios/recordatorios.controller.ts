import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildResponse } from '../common/helpers/response.helper';
import { RecordatoriosGestionService } from './recordatorios-gestion.service';
import { RecordatoriosCalendarioService } from './recordatorios-calendario.service';
import { CreateReminderDto, ReminderActionDto, ReminderQueryDto } from './recordatorios.dto';

@ApiTags('recordatorios')
@Controller('recordatorios')
@UseGuards(JwtAuthGuard)
export class RecordatoriosController {
  constructor(
    private readonly service: RecordatoriosGestionService,
    private readonly calendarService: RecordatoriosCalendarioService,
  ) {}
  @Get() list(@Query() q: ReminderQueryDto) {
    return this.service.list(q);
  }
  @Get('resumen') async summary() {
    return buildResponse(await this.service.summary());
  }
  @Get('calendario') async calendar(@Query() q: ReminderQueryDto) {
    return buildResponse(await this.calendarService.calendar(q));
  }
  @Get('agenda') agenda(@Query() q: ReminderQueryDto) {
    return this.calendarService.agenda(q);
  }
  @Get(':id/historial') history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ReminderQueryDto,
  ) {
    return this.service.history(id, q);
  }
  @Get(':id') async detail(@Param('id', ParseUUIDPipe) id: string) {
    return buildResponse(await this.service.detail(id));
  }
  @Post() async create(@Body() dto: CreateReminderDto, @CurrentUser() user: Usuario) {
    return buildResponse(await this.service.create(dto, user.id));
  }
  @Post(':id/editar') async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReminderActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.action(id, 'editar', dto, user.id));
  }
  @Post(':id/posponer') async postpone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReminderActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.action(id, 'posponer', dto, user.id));
  }
  @Post(':id/completar') async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReminderActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.action(id, 'completar', dto, user.id));
  }
  @Post(':id/cancelar') async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReminderActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.action(id, 'cancelar', dto, user.id));
  }
}

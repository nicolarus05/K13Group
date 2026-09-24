import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateSubscriptionDto,
  SubscriptionActionDto,
  SubscriptionQueryDto,
  UpdateSubscriptionDto,
} from './suscripciones.dto';
import { SuscripcionesService } from './suscripciones.service';

@ApiTags('suscripciones')
@Controller('suscripciones')
@UseGuards(JwtAuthGuard)
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}
  @Get() list(@Query() query: SubscriptionQueryDto) {
    return this.suscripcionesService.findAll(query);
  }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.suscripcionesService.findOne(id) };
  }
  @Get(':id/historial') history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SubscriptionQueryDto,
  ) {
    return this.suscripcionesService.history(id, query);
  }
  @Post() async create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: Usuario) {
    return { success: true, data: await this.suscripcionesService.create(dto, user.id) };
  }
  @Put(':id') async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() user: Usuario,
  ) {
    return { success: true, data: await this.suscripcionesService.update(id, dto, user.id) };
  }
  @Post(':id/suspender') async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscriptionActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return {
      success: true,
      data: await this.suscripcionesService.transition(id, 'suspender', dto, user.id),
    };
  }
  @Post(':id/reactivar') async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscriptionActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return {
      success: true,
      data: await this.suscripcionesService.transition(id, 'reactivar', dto, user.id),
    };
  }
  @Post(':id/cancelar') async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscriptionActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return {
      success: true,
      data: await this.suscripcionesService.transition(id, 'cancelar', dto, user.id),
    };
  }
}

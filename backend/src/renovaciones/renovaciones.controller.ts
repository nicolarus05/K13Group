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
import { SubscriptionActionDto } from '../suscripciones/suscripciones.dto';
import { RenovacionesService } from './renovaciones.service';
import {
  AdditionalCollectionDto,
  CollectDto,
  RenewalDto,
  RenewalPreferenceDto,
  RenewalQueryDto,
} from './renovaciones.dto';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('renovaciones')
@Controller('renovaciones')
@UseGuards(JwtAuthGuard)
export class RenovacionesController {
  constructor(private readonly service: RenovacionesService) {}
  @Get() list(@Query() query: RenewalQueryDto) {
    return this.service.list(query);
  }
  @Get('seguimiento') queue(@Query() query: RenewalQueryDto) {
    return this.service.queue(query);
  }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) {
    return buildResponse(await this.service.findOne(id));
  }
  @Post(':id/cobrar') async collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.collect(id, dto, user.id));
  }
  @Post(':id/cobro-adicional') async additionalCollection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdditionalCollectionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.addCollection(id, dto, user.id));
  }
  @Post(':id/anular') async annul(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscriptionActionDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.annul(id, dto, user.id));
  }
}
@ApiTags('renovaciones')
@Controller('suscripciones')
@UseGuards(JwtAuthGuard)
export class SubscriptionRenewalsController {
  constructor(private readonly service: RenovacionesService) {}
  @Post(':id/renovar') async renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewalDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.create(id, dto, user.id));
  }
  @Post(':id/primer-pago') async initial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewalDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.create(id, dto, user.id, true));
  }
  @Post(':id/preferencia-renovacion') async preference(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewalPreferenceDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.service.preference(id, dto, user.id));
  }
}

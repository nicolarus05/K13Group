import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CatalogQueryDto, CreateCatalogDto, UpdateCatalogDto } from '../catalogos/catalogo.dto';
import { OrderDto } from '../configuracion/configuracion.dto';
import { MetodosPagoService } from './metodos-pago.service';

@ApiTags('metodos-pago')
@UseGuards(JwtAuthGuard)
@Controller('metodos-pago')
export class MetodosPagoController {
  constructor(private readonly service: MetodosPagoService) {}
  @Get()
  @ApiOperation({ summary: 'Listar metodos-pago con filtros y paginación' })
  list(@Query() query: CatalogQueryDto) {
    return this.service.findAll(query);
  }
  @Get('orden') async order() {
    return { success: true, data: await this.service.order() };
  }
  @Put('orden') async reorder(@Body() dto: OrderDto, @CurrentUser() u: Usuario) {
    return { success: true, data: await this.service.reorder(dto, u.id) };
  }
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.findOne(id) };
  }
  @Post()
  async create(@Body() dto: CreateCatalogDto, @CurrentUser() user: Usuario) {
    return { success: true, data: await this.service.create(dto, user.id) };
  }
  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogDto,
    @CurrentUser() user: Usuario,
  ) {
    return { success: true, data: await this.service.update(id, dto, user.id) };
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar conservando las relaciones históricas' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: Usuario) {
    return { success: true, data: await this.service.remove(id, user.id) };
  }
  @Post(':id/reactivar')
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: Usuario) {
    return { success: true, data: await this.service.reactivate(id, user.id) };
  }
}

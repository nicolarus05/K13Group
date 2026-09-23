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
import { TarifasService } from './tarifas.service';

@ApiTags('tarifas')
@UseGuards(JwtAuthGuard)
@Controller('tarifas')
export class TarifasController {
  constructor(private readonly service: TarifasService) {}
  @Get()
  @ApiOperation({ summary: 'Listar tarifas con filtros y paginación' })
  list(@Query() query: CatalogQueryDto) {
    return this.service.findAll(query);
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

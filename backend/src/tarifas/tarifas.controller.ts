import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TarifasService } from './tarifas.service';
import { CreateTarifaDto, UpdateTarifaDto } from './dto/tarifa.dto';

@ApiTags('tarifas')
@UseGuards(JwtAuthGuard)
@Controller('tarifas')
export class TarifasController {
  constructor(private readonly tarifasService: TarifasService) {}

  @Get()
  @ApiOperation({ summary: 'Listar tarifas activas' })
  findAll(@Query('productoId') productoId?: string) { return this.tarifasService.findAll(productoId).then((data) => ({ success: true, data })); }

  @Post()
  create(@Body() dto: CreateTarifaDto) { return this.tarifasService.create(dto).then((data) => ({ success: true, data })); }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTarifaDto) { return this.tarifasService.update(id, dto).then((data) => ({ success: true, data })); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.tarifasService.remove(id).then((data) => ({ success: true, data })); }
}

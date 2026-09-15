import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferenciasService } from './referencias.service';
import { CreateReferenciaDto, UpdateReferenciaDto } from './dto/referencia.dto';

@ApiTags('referencias')
@UseGuards(JwtAuthGuard)
@Controller('referencias')
export class ReferenciasController {
  constructor(private readonly referenciasService: ReferenciasService) {}

  @Get()
  findAll(@Query('search') search?: string) { return this.referenciasService.findAll(search).then((data) => ({ success: true, data })); }
  @Post()
  create(@Body() dto: CreateReferenciaDto) { return this.referenciasService.create(dto).then((data) => ({ success: true, data })); }
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReferenciaDto) { return this.referenciasService.update(id, dto).then((data) => ({ success: true, data })); }
  @Delete(':id')
  remove(@Param('id') id: string) { return this.referenciasService.remove(id).then((data) => ({ success: true, data })); }
}

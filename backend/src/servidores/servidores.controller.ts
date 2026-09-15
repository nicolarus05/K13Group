import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServidoresService } from './servidores.service';
import { CreateServidorDto, UpdateServidorDto } from './dto/servidor.dto';

@ApiTags('servidores')
@UseGuards(JwtAuthGuard)
@Controller('servidores')
export class ServidoresController {
  constructor(private readonly servidoresService: ServidoresService) {}

  @Get()
  @ApiOperation({ summary: 'Listar servidores' })
  findAll() { return this.servidoresService.findAll().then((data) => ({ success: true, data })); }
  @Post()
  create(@Body() dto: CreateServidorDto) { return this.servidoresService.create(dto).then((data) => ({ success: true, data })); }
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServidorDto) { return this.servidoresService.update(id, dto).then((data) => ({ success: true, data })); }
  @Delete(':id')
  remove(@Param('id') id: string) { return this.servidoresService.remove(id).then((data) => ({ success: true, data })); }
}

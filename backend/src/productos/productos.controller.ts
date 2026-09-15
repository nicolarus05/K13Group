import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProductosService } from './productos.service';
import { CreateProductoDto, UpdateProductoDto } from './dto/producto.dto';

@ApiTags('productos')
@UseGuards(JwtAuthGuard)
@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar productos activos' })
  findAll(@Query('search') search?: string) { return this.productosService.findAll(search).then((data) => ({ success: true, data })); }

  @Post()
  @ApiOperation({ summary: 'Crear producto' })
  create(@Body() dto: CreateProductoDto) { return this.productosService.create(dto).then((data) => ({ success: true, data })); }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductoDto) { return this.productosService.update(id, dto).then((data) => ({ success: true, data })); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.productosService.remove(id).then((data) => ({ success: true, data })); }
}

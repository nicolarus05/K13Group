import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FindClientesDto } from './dto/find-clientes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('clientes')
@UseGuards(JwtAuthGuard)
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes' })
  async findAll(@Query() query: FindClientesDto) {
    const result = await this.clientesService.findAll(query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener ficha de cliente' })
  async findOne(@Param('id') id: string) {
    const data = await this.clientesService.findOne(id);
    return { success: true, data };
  }

  @Post()
  @ApiOperation({ summary: 'Crear cliente' })
  async create(@Body() dto: CreateClienteDto) {
    const data = await this.clientesService.create(dto);
    return { success: true, message: 'Cliente creado correctamente.', data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar cliente' })
  async update(@Param('id') id: string, @Body() dto: UpdateClienteDto) {
    const data = await this.clientesService.update(id, dto);
    return { success: true, message: 'Cliente actualizado correctamente.', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cliente (borrado lógico)' })
  async remove(@Param('id') id: string) {
    await this.clientesService.remove(id);
  }
}

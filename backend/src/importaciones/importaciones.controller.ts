import {
  Controller,
  Body,
  Get,
  Headers,
  Patch,
  Param,
  Post,
  ParseIntPipe,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Usuario } from '@prisma/client';
import { ConfirmarImportacionDto } from './dto/confirmar-importacion.dto';
import { EquivalenciaImportacionDto } from './dto/equivalencia-importacion.dto';
import { ImportacionFilasDto } from './dto/importacion-filas.dto';
import { ReconciliarImportacionDto } from './dto/reconciliar-importacion.dto';
import { RevisarImportacionFilaDto } from './dto/revisar-importacion-fila.dto';
import { ImportacionesService } from './importaciones.service';

@ApiTags('importaciones')
@UseGuards(JwtAuthGuard)
@Controller('importaciones')
export class ImportacionesController {
  constructor(private readonly importacionesService: ImportacionesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar importaciones históricas' })
  list(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 25,
  ) {
    return this.importacionesService.listImportaciones(page, limit);
  }

  @Post('clientes/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Previsualizar importación de CLIENTES 2026' })
  preview(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: Usuario) {
    return this.importacionesService.preview(file, user.id).then((data) => ({ success: true, data }));
  }

  @Post(':id/confirmar')
  @ApiOperation({ summary: 'Confirmar una importación revisada' })
  confirm(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmarImportacionDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService
      .confirm(id, user.id, idempotencyKey, dto)
      .then((data) => ({ success: true, data }));
  }

  @Post(':id/reconciliar')
  @ApiOperation({ summary: 'Reconciliar filas aceptadas y crear operaciones revisadas' })
  reconcile(
    @Param('id') id: string,
    @Body() dto: ReconciliarImportacionDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService.reconcile(id, user.id, dto).then((data) => ({ success: true, data }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar estado de una importación' })
  getOne(@Param('id') id: string) {
    return this.importacionesService.getImportacion(id).then((data) => ({ success: true, data }));
  }

  @Get(':id/filas')
  @ApiOperation({ summary: 'Consultar filas de una importación' })
  getRows(@Param('id') id: string, @Query() query: ImportacionFilasDto) {
    return this.importacionesService.getFilas(id, query);
  }

  @Get(':id/errores')
  @ApiOperation({ summary: 'Consultar errores y conflictos de una importación' })
  getErrors(@Param('id') id: string, @Query() query: ImportacionFilasDto) {
    return this.importacionesService.getFilas(id, query, true);
  }

  @Get(':id/catalogos')
  @ApiOperation({ summary: 'Consultar catálogos y equivalencias para revisar una importación' })
  getCatalogos(@Param('id') id: string) {
    return this.importacionesService.getCatalogos(id).then((data) => ({ success: true, data }));
  }

  @Get(':id/valores-pendientes')
  @ApiOperation({ summary: 'Consultar valores históricos sin equivalencia' })
  getPendingValues(@Param('id') id: string) {
    return this.importacionesService.getPendingValues(id).then((data) => ({ success: true, data }));
  }

  @Post(':id/equivalencias')
  @ApiOperation({ summary: 'Crear o actualizar una equivalencia revisada' })
  saveEquivalence(@Param('id') id: string, @Body() dto: EquivalenciaImportacionDto, @CurrentUser() user: Usuario) {
    return this.importacionesService.saveEquivalence(id, user.id, dto).then((data) => ({ success: true, data }));
  }

  @Patch(':id/filas/:filaId/revisar')
  @ApiOperation({ summary: 'Registrar la decisión de revisión de una fila' })
  reviewRow(
    @Param('id') id: string,
    @Param('filaId') filaId: string,
    @Body() dto: RevisarImportacionFilaDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService.reviewRow(id, filaId, user.id, dto).then((data) => ({ success: true, data }));
  }
}

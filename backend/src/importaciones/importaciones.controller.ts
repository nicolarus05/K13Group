import { AplicacionService } from './aplicacion.service';
import { AplicacionQueryDto, ProponerImportacionDto, ConfirmarLoteDto } from './dto/aplicacion.dto';
import {
  Controller,
  Body,
  Get,
  Headers,
  Patch,
  Param,
  Post,
  ParseIntPipe,
  ParseUUIDPipe,
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
import { CorregirLecturaDto } from './dto/corregir-lectura.dto';
import { IdentidadesService } from './identidades.service';
import { DecidirIdentidadDto, IdentidadesQueryDto } from './dto/identidades.dto';
import { EquivalenciasRevisionService } from './equivalencias-revision.service';
import { DecidirEquivalenciaDto, EquivalenciasQueryDto } from './dto/equivalencias-revision.dto';

@ApiTags('importaciones')
@UseGuards(JwtAuthGuard)
@Controller('importaciones')
export class ImportacionesController {
  constructor(
    private readonly importacionesService: ImportacionesService,
    private readonly aplicacion: AplicacionService,
    private readonly identidades: IdentidadesService,
    private readonly equivalencias: EquivalenciasRevisionService,
  ) {}

  @Get(':id/aplicacion')
  application(@Param('id', ParseUUIDPipe) id: string, @Query() query: AplicacionQueryDto) {
    return this.aplicacion.list(id, query);
  }
  @Post(':id/lotes')
  proposeBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProponerImportacionDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.aplicacion.propose(id, user.id, dto);
  }
  @Post(':id/lotes/:loteId/confirmar')
  confirmBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('loteId', ParseUUIDPipe) loteId: string,
    @Body() dto: ConfirmarLoteDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.aplicacion.confirm(id, loteId, user.id, dto);
  }

  @Get(':id/equivalencias-revision')
  reviewEquivalences(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: EquivalenciasQueryDto,
  ) {
    return this.equivalencias.list(id, query);
  }

  @Post(':id/equivalencias-revision/previsualizar')
  previewEquivalence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidirEquivalenciaDto) {
    return this.equivalencias.preview(id, dto);
  }

  @Patch(':id/equivalencias-revision')
  decideEquivalence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidirEquivalenciaDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.equivalencias.decide(id, user.id, dto);
  }

  @Get(':id/identidades')
  identities(@Param('id', ParseUUIDPipe) id: string, @Query() query: IdentidadesQueryDto) {
    return this.identidades.list(id, query);
  }
  @Get(':id/identidades/clientes')
  identityClients(@Param('id', ParseUUIDPipe) id: string, @Query() query: IdentidadesQueryDto) {
    return this.identidades.clients(id, query);
  }
  @Post(':id/identidades/preparar')
  prepareIdentities(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: Usuario) {
    return this.identidades.prepare(id, user.id);
  }
  @Patch(':id/identidades/decidir')
  decideIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Usuario,
    @Body() dto: DecidirIdentidadDto,
  ) {
    return this.identidades.decide(id, user.id, dto);
  }

  @Patch(':id/filas/:filaId/lectura')
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('filaId', ParseUUIDPipe) filaId: string,
    @Body() dto: CorregirLecturaDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService
      .correctReading(id, filaId, user.id, dto)
      .then((data) => ({ success: true, data }));
  }

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
    return this.importacionesService
      .preview(file, user.id)
      .then((data) => ({ success: true, data }));
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
    return this.importacionesService
      .reconcile(id, user.id, dto)
      .then((data) => ({ success: true, data }));
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
  saveEquivalence(
    @Param('id') id: string,
    @Body() dto: EquivalenciaImportacionDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService
      .saveEquivalence(id, user.id, dto)
      .then((data) => ({ success: true, data }));
  }

  @Patch(':id/filas/:filaId/revisar')
  @ApiOperation({ summary: 'Registrar la decisión de revisión de una fila' })
  reviewRow(
    @Param('id') id: string,
    @Param('filaId') filaId: string,
    @Body() dto: RevisarImportacionFilaDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.importacionesService
      .reviewRow(id, filaId, user.id, dto)
      .then((data) => ({ success: true, data }));
  }
}

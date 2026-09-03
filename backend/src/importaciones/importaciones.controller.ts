import {
  Controller,
  Body,
  Get,
  Headers,
  Param,
  Post,
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
import { ImportacionFilasDto } from './dto/importacion-filas.dto';
import { ImportacionesService } from './importaciones.service';

@ApiTags('importaciones')
@UseGuards(JwtAuthGuard)
@Controller('importaciones')
export class ImportacionesController {
  constructor(private readonly importacionesService: ImportacionesService) {}

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
}

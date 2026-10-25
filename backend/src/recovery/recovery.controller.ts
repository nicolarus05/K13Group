import {
  Body,
  Query,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
  StreamableFile,
  HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Usuario } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PasswordDto } from '../users/users.dto';
import { SettingsQueryDto } from '../configuracion/configuracion.dto';
import { RecoveryDto } from './recovery.dto';
import { RecoveryService } from './recovery.service';
@Controller('configuracion/copias')
@UseGuards(JwtAuthGuard)
export class RecoveryController {
  constructor(private readonly service: RecoveryService) {}
  @Get('programacion') async schedule() {
    return { success: true, data: await this.service.schedule() };
  }
  @Get() async list(@Query() q: SettingsQueryDto) {
    const rows = await this.service.list();
    const page = q.page ?? 1,
      limit = q.limit ?? 25;
    return {
      success: true,
      data: rows.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) },
      disponible: await this.service.heartbeat(),
    };
  }
  @Get(':id') async metadata(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.metadata(id) };
  }
  @Post()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async create(@Body() dto: RecoveryDto, @CurrentUser() u: Usuario) {
    return { success: true, data: await this.service.submit('backup', dto, u.id) };
  }
  @Post(':id/validar-restauracion')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
    @CurrentUser() u: Usuario,
  ) {
    return { success: true, data: await this.service.submit('validate', dto, u.id, id) };
  }
  @Post(':id/restaurar')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
    @CurrentUser() u: Usuario,
  ) {
    return { success: true, data: await this.service.submit('restore', dto, u.id, id) };
  }
  @Post(':id/eliminar')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
    @CurrentUser() u: Usuario,
  ) {
    return { success: true, data: await this.service.submit('delete', dto, u.id, id) };
  }
  @Post(':id/descargar')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PasswordDto,
    @CurrentUser() u: Usuario,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.service.download(id, dto.password, u.id);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="k13-${id}.tar"`,
    });
    return new StreamableFile(stream);
  }
}
// Autenticación independiente de la base sustituida, limitada a un único trabajo.
@Controller('configuracion/trabajos')
export class RecoveryStatusController {
  constructor(private readonly service: RecoveryService) {}
  @Get(':id') async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth: string,
  ) {
    return {
      success: true,
      data: await this.service.status(id, auth?.replace(/^Bearer /, '') || ''),
    };
  }
}

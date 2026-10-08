import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfiguracionService } from './configuracion.service';
import { EditSettingsDto, LogoDto, SettingsQueryDto } from './configuracion.dto';
@ApiTags('configuracion')
@UseGuards(JwtAuthGuard)
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly service: ConfiguracionService) {}
  @Get() async get() {
    return { success: true, data: await this.service.get() };
  }
  @Patch()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async update(@Body() dto: EditSettingsDto, @CurrentUser() user: Usuario) {
    return { success: true, data: await this.service.update(dto, user.id) };
  }
  @Post('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async logo(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: LogoDto,
    @CurrentUser() user: Usuario,
  ) {
    return { success: true, data: await this.service.logo(file, dto, user.id) };
  }
  @Get('logo/:id') async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(await this.service.image(id));
  }
  @Get('historial') async history(@Query() q: SettingsQueryDto) {
    return { success: true, ...(await this.service.history(q.page ?? 1, q.limit ?? 25)) };
  }
  @Get('sistema') async system() {
    return { success: true, data: await this.service.system() };
  }
}

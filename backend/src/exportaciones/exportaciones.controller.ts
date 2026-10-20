import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExportHistoryQuery, ExportRequest } from './exportaciones.dto';
import { ExportacionesService } from './exportaciones.service';

@Controller('exportaciones')
@UseGuards(JwtAuthGuard)
export class ExportacionesController {
  constructor(private readonly service: ExportacionesService) {}
  @Get()
  history(@Query() q: ExportHistoryQuery) {
    return this.service.history(q.page);
  }
  @Post(':modulo')
  async generate(
    @Param('modulo') module: string,
    @Body() body: ExportRequest,
    @CurrentUser() user: Usuario,
    @Res() res: Response,
  ) {
    const result = await this.service.generate(module, body, user.id);
    res
      .set({
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .status(200)
      .send(result.buffer);
  }
}

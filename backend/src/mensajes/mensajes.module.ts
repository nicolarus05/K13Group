import {
  Module,
  Controller,
  Get,
  Put,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
  Header,
} from '@nestjs/common';
import { IsInt, IsString, Min, MaxLength } from 'class-validator';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MensajesService } from './mensajes.service';
class EditarPlantillaDto {
  @IsInt() @Min(0) version!: number;
  @IsString() @MaxLength(10000) texto!: string;
}
@Controller('mensajes')
@UseGuards(JwtAuthGuard)
class MensajesController {
  constructor(private readonly service: MensajesService) {}
  @Get('plantillas') @Header('Cache-Control', 'no-store') list() {
    return this.service.list();
  }
  @Put('plantillas/:tipo') save(
    @Param('tipo') tipo: string,
    @Body() dto: EditarPlantillaDto,
    @CurrentUser() user: Usuario,
  ) {
    return this.service.save(tipo, dto, user.id);
  }
  @Get('clientes/:id') @Header('Cache-Control', 'no-store') context(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.context(id);
  }
}
@Module({ controllers: [MensajesController], providers: [MensajesService] })
export class MensajesModule {}

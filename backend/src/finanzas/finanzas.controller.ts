import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildResponse } from '../common/helpers/response.helper';
import {
  AnnulExpenseDto,
  CreateExpenseDto,
  FinanceQueryDto,
  UpdateExpenseDto,
} from './finanzas.dto';
import { FinanzasService } from './finanzas.service';

@ApiTags('finanzas')
@Controller('finanzas')
@UseGuards(JwtAuthGuard)
export class FinanzasController {
  constructor(private readonly finanzasService: FinanzasService) {}
  @Get() list(@Query() query: FinanceQueryDto) {
    return this.finanzasService.list(query);
  }
  @Get('balance') async balance(@Query() query: FinanceQueryDto) {
    return buildResponse(await this.finanzasService.balance(query));
  }
  @Get(':id/historial') history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FinanceQueryDto,
  ) {
    return this.finanzasService.history(id, query);
  }
  @Get(':id') async get(@Param('id', ParseUUIDPipe) id: string) {
    return buildResponse(await this.finanzasService.findOne(id));
  }
  @Post('gasto') async create(@Body() dto: CreateExpenseDto, @CurrentUser() user: Usuario) {
    return buildResponse(await this.finanzasService.create(dto, user.id));
  }
  @Put(':id') async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.finanzasService.update(id, dto, user.id));
  }
  @Post(':id/anular') async annul(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnulExpenseDto,
    @CurrentUser() user: Usuario,
  ) {
    return buildResponse(await this.finanzasService.annul(id, dto, user.id));
  }
}

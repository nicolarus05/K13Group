import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { buildResponse } from '../common/helpers/response.helper';
import { DashboardClientsDto, DashboardQueryDto } from './dashboard.dto';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}
  @Get() async summary(@Query() query: DashboardQueryDto) {
    return buildResponse(await this.dashboardService.summary(query));
  }
  @Get('clientes') clients(@Query() query: DashboardClientsDto) {
    return this.dashboardService.clients(query);
  }
}

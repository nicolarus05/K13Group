import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TarifasService } from './tarifas.service';

@ApiTags('tarifas')
@Controller('tarifas')
export class TarifasController {
  constructor(private readonly tarifasService: TarifasService) {}
}

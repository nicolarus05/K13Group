import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RenovacionesService } from './renovaciones.service';

@ApiTags('renovaciones')
@Controller('renovaciones')
export class RenovacionesController {
  constructor(private readonly renovacionesService: RenovacionesService) {}
}

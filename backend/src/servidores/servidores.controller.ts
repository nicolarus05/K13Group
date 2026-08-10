import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServidoresService } from './servidores.service';

@ApiTags('servidores')
@Controller('servidores')
export class ServidoresController {
  constructor(private readonly servidoresService: ServidoresService) {}
}

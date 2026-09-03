import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConfirmarImportacionDto {
  @ApiProperty({ description: 'Debe ser true para ejecutar la importación.' })
  @IsBoolean()
  confirmar!: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Permite confirmar filas con advertencias no bloqueantes.',
  })
  @IsOptional()
  @IsBoolean()
  permitirAdvertencias = false;
}

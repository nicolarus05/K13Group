import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ImportacionFilasDto {
  @IsOptional() @IsIn(['CLIENTE', 'SUSCRIPCION', 'FINANZAS', 'AVISO']) ambito?: string;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({ required: false, default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @ApiProperty({ required: false, description: 'Filtrar por estado de la fila.' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  estado?: string;

  @ApiProperty({ required: false, description: 'Filtrar por hoja del Excel.' })
  @IsOptional()
  @IsString()
  @MaxLength(31)
  hoja?: string;

  @ApiProperty({ required: false, description: 'Buscar en nombre, teléfono o valor original.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buscar?: string;
}

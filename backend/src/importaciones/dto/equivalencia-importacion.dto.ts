import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const EQUIVALENCE_TYPES = ['PRODUCTO', 'SERVIDOR', 'REFERENCIA', 'PAGO', 'TARIFA'] as const;
export type EquivalenceType = (typeof EQUIVALENCE_TYPES)[number];

export class EquivalenciaImportacionDto {
  @ApiProperty({ enum: EQUIVALENCE_TYPES })
  @IsIn(EQUIVALENCE_TYPES)
  tipo!: EquivalenceType;

  @ApiProperty({ description: 'Valor original visible en el Excel.' })
  @IsString()
  @MaxLength(255)
  valorOrigen!: string;

  @ApiProperty({ description: 'Clave normalizada usada por el motor de reconciliación.' })
  @IsString()
  @MaxLength(255)
  valorClave!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  valorCanonico!: string;

  @ApiPropertyOptional({ description: 'ID del registro del catálogo de destino.' })
  @IsOptional()
  @IsUUID()
  entidadId?: string;
}

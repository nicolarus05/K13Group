import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ReconciliarImportacionDto {
  @ApiProperty({
    description: 'Confirma la creación de suscripciones y operaciones históricas revisadas.',
  })
  @IsBoolean()
  confirmarOperaciones!: boolean;

  @ApiPropertyOptional({
    description: 'Confirma expresamente la creación de renovaciones y movimientos financieros.',
  })
  @IsOptional()
  @IsBoolean()
  confirmarFinanzas = false;
}

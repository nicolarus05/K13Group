import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const ROW_DECISIONS = ['ACEPTAR', 'RECHAZAR', 'PENDIENTE'] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

export class RevisarImportacionFilaDto {
  @ApiProperty({ enum: ROW_DECISIONS })
  @IsIn(ROW_DECISIONS)
  decision!: RowDecision;

  @ApiPropertyOptional({ description: 'Cliente existente al que se vincula la fila.' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tarifaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  servidorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  referenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  metodoPagoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacion?: string;
}

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const EQUIVALENCE_TYPES = ['PRODUCTO', 'TARIFA', 'SERVIDOR', 'REFERENCIA', 'PAGO'] as const;
export type EquivalenceType = (typeof EQUIVALENCE_TYPES)[number];
export class EquivalenciasQueryDto {
  @IsOptional() @IsIn(EQUIVALENCE_TYPES) tipo: EquivalenceType = 'PRODUCTO';
  @IsOptional() @IsString() @MaxLength(31) hoja?: string;
  @IsOptional()
  @IsIn(['PENDIENTE', 'REVISAR', 'RESUELTA', 'HISTORICA', 'SIN_DATO', 'IGNORADO', 'EXCLUIDO'])
  estado?: string;
  @IsOptional() @Matches(/^[a-f0-9]{64}$/) clave?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 25;
}
export class DecidirEquivalenciaDto {
  @Matches(/^[a-f0-9]{64}$/) huellaRevision!: string;
  @IsUUID() solicitudId!: string;
  @IsIn(EQUIVALENCE_TYPES) tipo!: EquivalenceType;
  @IsIn(['VALOR', 'FILA']) alcance!: 'VALOR' | 'FILA';
  @Matches(/^[a-f0-9]{64}$/) clave!: string;
  @IsOptional() @IsUUID() filaId?: string;
  @IsIn(['ASIGNAR', 'PENDIENTE', 'HEREDAR']) accion!: 'ASIGNAR' | 'PENDIENTE' | 'HEREDAR';
  @IsOptional() @IsUUID() entidadId?: string;
  @IsOptional() @IsBoolean() historico = false;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}

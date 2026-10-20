import { Transform, Type } from 'class-transformer';
import {
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
  ValidateIf,
} from 'class-validator';

export class SubscriptionQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsUUID() clienteId?: string;
  @IsOptional() @IsUUID() productoId?: string;
  @IsOptional() @IsUUID() servidorId?: string;
  @IsOptional() @IsUUID() referenciaId?: string;
  @IsOptional()
  @IsIn(['ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA', 'SUSPENDIDA', 'CANCELADA', 'HISTORICA'])
  estado?: string;
  @IsIn(['fechaFin', 'createdAt']) sort: 'fechaFin' | 'createdAt' = 'fechaFin';
  @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc';
}
export class CreateSubscriptionDto {
  @IsUUID() solicitudId!: string;
  @IsUUID() clienteId!: string;
  @IsUUID() productoId!: string;
  @IsUUID() tarifaId!: string;
  @IsUUID() servidorId!: string;
  @IsOptional() @IsUUID() referenciaId?: string | null;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) fechaInicio!: string;
  @ValidateIf((_obj, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  tipoDispositivo?: string;
}
export class VersionDto {
  @Type(() => Number) @IsInt() @Min(1) version!: number;
}
export class SubscriptionActionDto extends VersionDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}
export class UpdateSubscriptionDto extends VersionDto {
  @ValidateIf((_obj, value) => value !== undefined) @IsUUID() tarifaId?: string;
  @ValidateIf((_obj, value) => value !== undefined) @IsUUID() servidorId?: string;
  @IsOptional() @IsUUID() referenciaId?: string | null;
  @ValidateIf((_obj, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  tipoDispositivo?: string;
  @ValidateIf((_obj, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaInicio?: string;
  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivoCorreccion?: string;
}

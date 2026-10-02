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
} from 'class-validator';

export class ReminderQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsUUID() clienteId?: string;
  @IsOptional() @IsIn(['RENOVACION', 'COBRO', 'TELEGRAM']) tipo?: string;
  @IsOptional() @IsIn(['PENDIENTE', 'POSPUESTO', 'COMPLETADO', 'CANCELADO']) estado?: string;
  @IsIn(['atencion', 'hoy', 'atrasados', 'proximos', 'todos']) vista = 'atencion';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta?: string;
}
export class CreateReminderDto {
  @IsUUID() solicitudId!: string;
  @IsUUID() clienteId!: string;
  @IsOptional() @IsUUID() suscripcionId?: string;
  @IsIn(['RENOVACION', 'COBRO', 'TELEGRAM']) tipo!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) fecha!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  descripcion!: string;
}
export class ReminderActionDto {
  @IsInt() @Min(1) version!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fecha?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  descripcion?: string;
}

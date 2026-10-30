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
  ValidateIf,
} from 'class-validator';
import { VersionDto, SubscriptionActionDto } from '../suscripciones/suscripciones.dto';

export class RenewalDto extends VersionDto {
  @IsUUID() solicitudId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/) importe!: string;
  @IsUUID() metodoPagoId!: string;
  @IsIn(['CONFIRMADO', 'PENDIENTE']) cobro!: 'CONFIRMADO' | 'PENDIENTE';
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaPrevistaCobro?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaCobro?: string;
  @IsOptional() @IsString() @MaxLength(1000) observaciones?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivoImporte?: string;
}
export class CollectDto extends VersionDto {
  @IsUUID() metodoPagoId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) fechaCobro!: string;
}
export class AdditionalCollectionDto extends CollectDto {
  @IsUUID() solicitudId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/) importe!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}
export class RenewalQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsUUID() suscripcionId?: string;
  @IsOptional() @IsUUID() clienteId?: string;
  @IsOptional() @IsUUID() productoId?: string;
  @IsOptional() @IsIn(['COMPLETADA', 'ANULADA']) estado?: string;
  @IsOptional() @IsIn(['PENDIENTE', 'CONFIRMADO', 'GRATIS']) cobro?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta?: string;
  @IsIn(['hoy', 'manana', 'proximas', 'vencidas', 'no-renovar', 'todas']) vista = 'todas';
}
export class RenewalPreferenceDto extends SubscriptionActionDto {
  @IsBoolean() noRenovar!: boolean;
}

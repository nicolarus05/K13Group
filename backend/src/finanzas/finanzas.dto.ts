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
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class FinanceQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(['INGRESO', 'GASTO']) tipo?: string;
  @IsOptional() @IsIn(['CONFIRMADO', 'PENDIENTE', 'ANULADO']) estado?: string;
  @IsOptional() @IsUUID() categoriaGastoId?: string;
  @IsOptional() @IsUUID() metodoPagoId?: string;
  @IsOptional() @IsUUID() clienteId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta?: string;
}
export class ExpenseFieldsDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) concepto!: string;
  @IsUUID() categoriaGastoId!: string;
  @IsUUID() metodoPagoId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/) importe!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) fecha!: string;
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  observaciones?: string;
}
export class CreateExpenseDto extends ExpenseFieldsDto {
  @IsUUID() solicitudId!: string;
}
export class UpdateExpenseDto extends ExpenseFieldsDto {
  @IsInt() @Min(1) version!: number;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) motivo!: string;
}
export class AnnulExpenseDto {
  @IsInt() @Min(1) version!: number;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) motivo!: string;
}

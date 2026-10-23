import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  Min,
  Max,
  IsObject,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
  ArrayUnique,
  IsArray,
} from 'class-validator';
export class SensitiveDto {
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}
export class EditSettingsDto extends SensitiveDto {
  @Type(() => Number) @IsInt() @Min(0) version!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
  @IsObject() cambios!: Record<string, unknown>;
}
export class LogoDto extends SensitiveDto {
  @Type(() => Number) @IsInt() @Min(0) version!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}
export class OrderDto {
  @IsInt() @Min(0) version!: number;
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
  @IsString() @MinLength(3) @MaxLength(1000) motivo!: string;
}

export class SettingsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

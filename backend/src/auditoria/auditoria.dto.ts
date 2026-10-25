import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AuditoriaQueryDto {
  @IsOptional() @IsString() @MaxLength(100) tabla?: string;
  @IsOptional() @IsString() @MaxLength(50) accion?: string;
  @IsOptional() @IsUUID() usuarioId?: string;
  @IsOptional() @IsUUID() registroId?: string;
  @IsOptional() @IsIn(['usuario', 'sistema']) origen?: 'usuario' | 'sistema';
  @IsOptional() @IsISO8601({ strict: true }) desde?: string;
  @IsOptional() @IsISO8601({ strict: true }) hasta?: string;
  @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

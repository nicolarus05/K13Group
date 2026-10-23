import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class IdentidadesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 25;
  @IsOptional()
  @IsIn(['PENDIENTE', 'CONFLICTO', 'REVISAR', 'NUEVO', 'VINCULADO', 'EXCLUIDO'])
  estado?: string;
  @IsOptional() @IsString() @MaxLength(150) buscar?: string;
  @IsOptional() @IsUUID() identidadId?: string;
}

export class DecidirIdentidadDto {
  @IsInt() @Min(1) version!: number;
  @IsUUID() solicitudId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  filas!: string[];
  @IsIn(['NUEVO', 'VINCULAR', 'PENDIENTE', 'EXCLUIR']) accion!:
    'NUEVO' | 'VINCULAR' | 'PENDIENTE' | 'EXCLUIR';
  @IsOptional() @IsObject() datos?: Record<string, unknown>;
  @IsOptional() @IsUUID() clienteDestinoId?: string;
  @IsOptional() @IsString() @MaxLength(64) huellaCliente?: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}

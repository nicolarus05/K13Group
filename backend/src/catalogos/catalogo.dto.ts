import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CatalogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ enum: ['activo', 'inactivo', 'todos'] })
  @IsIn(['activo', 'inactivo', 'todos'])
  estado: 'activo' | 'inactivo' | 'todos' = 'activo';
  @ApiPropertyOptional({ enum: ['nombre', 'createdAt'] })
  @IsIn(['nombre', 'createdAt'])
  sort: 'nombre' | 'createdAt' = 'nombre';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productoId?: string;
}

export class CreateCatalogDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nombre!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observaciones?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productoId?: string;
  @ApiPropertyOptional({ enum: [12] })
  @IsOptional()
  @Type(() => Number)
  @Equals(12)
  duracionMeses?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  precio?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esGratuito?: boolean;
}
export class UpdateCatalogDto extends PartialType(CreateCatalogDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ExportRequest {
  @IsIn(['xlsx', 'csv', 'pdf']) formato!: 'xlsx' | 'csv' | 'pdf';
  @IsObject() filtros: Record<string, unknown> = {};
  @IsOptional() @IsString() @MaxLength(30) seccion?: string;
}
export class ExportHistoryQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}

import { IsInt, IsObject, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
export class CorregirLecturaDto {
  @IsInt() @Min(1) version!: number;
  @IsObject() cambios!: Record<string, string | null>;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}

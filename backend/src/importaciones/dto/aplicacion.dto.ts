import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

export class OperacionImportacionDto {
  @IsUUID() filaId!: string;
  @IsIn(['NINGUNO', 'NUEVO', 'VINCULAR', 'CONSERVAR']) servicio!:
    'NINGUNO' | 'NUEVO' | 'VINCULAR' | 'CONSERVAR';
  @IsOptional() @IsIn(['ALTA', 'RENOVACION']) tipoOperacion?: 'ALTA' | 'RENOVACION';
  @IsOptional() @IsUUID() suscripcionId?: string;
  @IsOptional() @IsUUID() grupoId?: string;
  @IsOptional() @IsBoolean() servicioDistinto = false;
  @IsOptional() @IsString() @MaxLength(150) referenciaPropia?: string;
  @IsIn(['NINGUNA', 'COBRADO', 'DEUDA', 'GRATIS']) finanzas!:
    'NINGUNA' | 'COBRADO' | 'DEUDA' | 'GRATIS';
}
export class ProponerImportacionDto {
  @IsUUID() solicitudId!: string;
  @Matches(/^[a-f0-9]{64}$/) huellaRevision!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((row: OperacionImportacionDto) => row.filaId)
  @ValidateNested({ each: true })
  @Type(() => OperacionImportacionDto)
  filas!: OperacionImportacionDto[];
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  motivo!: string;
}
export class ConfirmarLoteDto {
  @Equals(true) confirmar!: boolean;
  @IsBoolean() confirmarFinanzas!: boolean;
}
export class AplicacionQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lotesPage = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 25;
  @IsOptional() @IsString() @MaxLength(31) hoja?: string;
}

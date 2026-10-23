import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
export class RecoveryDto {
  @IsUUID() solicitudId!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(100) confirmacion?: string;
}

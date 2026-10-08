import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
export class PasswordDto {
  @IsString() @MaxLength(200) password!: string;
}
export class NewPasswordDto extends PasswordDto {
  @IsString() @MinLength(12) @MaxLength(72) nueva!: string;
  @IsString() @MaxLength(72) confirmacion!: string;
}
export class ProfileDto extends PasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  nombre!: string;
  @IsString() @MinLength(3) @MaxLength(50) @Matches(/^[a-zA-Z0-9_.-]+$/) username!: string;
  @IsString() version!: string;
}

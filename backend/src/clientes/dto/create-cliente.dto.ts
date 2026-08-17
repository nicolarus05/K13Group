import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClienteDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  nombre: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

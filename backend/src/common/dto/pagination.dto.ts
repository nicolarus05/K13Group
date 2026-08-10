import { ApiProperty } from '@nestjs/swagger';

export class PaginationDto {
  @ApiProperty({ default: 1, required: false })
  page?: number = 1;

  @ApiProperty({ default: 25, required: false })
  limit?: number = 25;
}

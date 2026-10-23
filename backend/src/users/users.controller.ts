import { Body, Controller, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Usuario } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { NewPasswordDto, ProfileDto } from './users.dto';
@Controller('users')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60000 } })
export class UsersController {
  constructor(private readonly service: UsersService) {}
  @Patch('me') async profile(@CurrentUser() u: Usuario, @Body() dto: ProfileDto) {
    return { success: true, data: await this.service.profile(u.id, dto) };
  }
  @Post('me/password') async password(
    @CurrentUser() u: Usuario,
    @Body() dto: NewPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.password(u.id, dto);
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { success: true };
  }
}

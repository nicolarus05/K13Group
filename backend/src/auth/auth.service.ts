import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, res: Response) {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user) throw new UnauthorizedException('Credenciales incorrectas');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Credenciales incorrectas');

    if (!user.activo) throw new UnauthorizedException('Usuario desactivado');

    await this.usersService.updateLastLogin(user.id);
    this.setCookies(res, user.id);

    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  logout(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  async refresh(userId: string, res: Response) {
    this.setCookies(res, userId);
  }

  private setCookies(res: Response, userId: string) {
    const isProd = this.config.get('NODE_ENV') === 'production';
    const base = { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/' };

    res.cookie(
      ACCESS_COOKIE,
      this.sign(userId, 'JWT_SECRET', this.config.get('JWT_EXPIRES_IN', '15m') as JwtSignOptions['expiresIn']),
      { ...base, maxAge: 15 * 60 * 1000 },
    );

    res.cookie(
      REFRESH_COOKIE,
      this.sign(userId, 'JWT_REFRESH_SECRET', this.config.get('JWT_REFRESH_EXPIRES_IN', '7d') as JwtSignOptions['expiresIn']),
      { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 },
    );
  }

  private sign(userId: string, secretKey: string, expiresIn: JwtSignOptions['expiresIn']) {
    return this.jwtService.sign(
      { sub: userId },
      { secret: this.config.getOrThrow(secretKey), expiresIn },
    );
  }
}

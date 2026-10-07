import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { isUUID } from 'class-validator';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { LoginDto } from './dto/login.dto';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
export interface SessionPayload {
  sub: string;
  sid: string;
  exp: number;
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: LoginDto, res: Response) {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)) || !user.activo)
      throw new UnauthorizedException('Credenciales incorrectas');

    const sid = randomUUID();
    const refresh = this.sign(user.id, sid, 'JWT_REFRESH_SECRET', 'JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresAt = new Date(this.jwtService.decode<SessionPayload>(refresh).exp * 1000);
    // Persistir antes de emitir cookies. Cada login tiene una sesión independiente.
    await this.prisma.$transaction([
      this.prisma.sesion.create({
        data: { id: sid, usuarioId: user.id, token: tokenHash(refresh), expiresAt },
      }),
      this.prisma.usuario.update({ where: { id: user.id }, data: { ultimoLogin: new Date() } }),
    ]);
    this.setAccess(res, user.id, sid);
    this.setCookie(res, REFRESH_COOKIE, refresh);
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async validateSession(payload: SessionPayload, refresh?: string) {
    if (!isUUID(payload.sub) || !isUUID(payload.sid)) throw new UnauthorizedException();
    const session = await this.prisma.sesion.findFirst({
      where: {
        id: payload.sid,
        usuarioId: payload.sub,
        expiresAt: { gt: new Date() },
        ...(refresh ? { token: tokenHash(refresh) } : {}),
      },
      include: { usuario: true },
    });
    if (!session || !session.usuario.activo) throw new UnauthorizedException();
    return session.usuario;
  }

  async logout(req: Request, res: Response) {
    // Logout funciona incluso con access expirado. Solo una firma válida puede
    // revocar una sesión; cookies ausentes/manipuladas se limpian igualmente.
    for (const [cookie, key] of [
      [REFRESH_COOKIE, 'JWT_REFRESH_SECRET'],
      [ACCESS_COOKIE, 'JWT_SECRET'],
    ]) {
      const token = req.cookies?.[cookie];
      if (typeof token !== 'string') continue;
      let payload: SessionPayload;
      try {
        payload = this.jwtService.verify<SessionPayload>(token, {
          secret: this.config.getOrThrow<string>(key),
          ignoreExpiration: true,
        });
      } catch {
        continue;
      }
      if (isUUID(payload.sub) && isUUID(payload.sid)) {
        await this.prisma.sesion.deleteMany({ where: { id: payload.sid, usuarioId: payload.sub } });
      }
    }
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  refresh(req: Request, res: Response) {
    // El guard ya ha comprobado firma, caducidad, hash, sesión y usuario.
    const payload = this.jwtService.decode<SessionPayload>(req.cookies[REFRESH_COOKIE]);
    this.setAccess(res, payload.sub, payload.sid);
    // La sesión conserva su vencimiento absoluto; refrescar no lo prolonga.
  }

  private setAccess(res: Response, userId: string, sid: string) {
    this.setCookie(
      res,
      ACCESS_COOKIE,
      this.sign(userId, sid, 'JWT_SECRET', 'JWT_EXPIRES_IN', '15m'),
    );
  }

  private setCookie(res: Response, name: string, token: string) {
    const expires = new Date(this.jwtService.decode<SessionPayload>(token).exp * 1000);
    res.cookie(name, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  private sign(
    userId: string,
    sid: string,
    secretKey: string,
    durationKey: string,
    fallback: string,
  ) {
    return this.jwtService.sign(
      { sub: userId, sid },
      {
        secret: this.config.getOrThrow<string>(secretKey),
        expiresIn: this.config.get<string>(durationKey, fallback) as JwtSignOptions['expiresIn'],
      },
    );
  }
}

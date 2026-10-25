import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { isUUID } from 'class-validator';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { lockUser } from '../users/account';
import { readSettings } from '../configuracion/settings';
import { LoginDto } from './dto/login.dto';
import { writeAudit } from '../auditoria/audit-data';

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

    const { sid, refresh, expiresAt, profile } = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id);
      const current = await tx.usuario.findUniqueOrThrow({ where: { id: user.id } });
      if (
        !current.activo ||
        current.passwordHash !== user.passwordHash ||
        current.username !== dto.username
      )
        throw new UnauthorizedException('Credenciales incorrectas');
      const sid = randomUUID();
      const days = await tx.configuracion.findUnique({ where: { clave: 'seguridad.sesion_dias' } });
      const refresh = this.sign(
        user.id,
        sid,
        'JWT_REFRESH_SECRET',
        'JWT_REFRESH_EXPIRES_IN',
        '7d',
        days ? `${(await readSettings(tx))['seguridad.sesion_dias']}d` : undefined,
      );
      const expiresAt = new Date(this.jwtService.decode<SessionPayload>(refresh).exp * 1000);
      await tx.sesion.create({
        data: { id: sid, usuarioId: user.id, token: tokenHash(refresh), expiresAt },
      });
      const profile = await tx.usuario.update({
        where: { id: user.id },
        data: { ultimoLogin: new Date() },
      });
      await writeAudit(tx, user.id, 'cuenta', user.id, 'INICIAR_SESION', null, null);
      return { sid, refresh, expiresAt, profile };
    });
    await this.setAccess(res, user.id, sid, expiresAt);
    this.setCookie(res, REFRESH_COOKIE, refresh);
    const { passwordHash: _, ...safe } = profile;
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
        await this.prisma.$transaction(async (tx) => {
          const removed = await tx.sesion.deleteMany({
            where: { id: payload.sid, usuarioId: payload.sub },
          });
          if (removed.count)
            await writeAudit(tx, payload.sub, 'cuenta', payload.sub, 'CERRAR_SESION', null, null);
        });
      }
    }
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  async refresh(req: Request, res: Response) {
    // El guard ya ha comprobado firma, caducidad, hash, sesión y usuario.
    const payload = this.jwtService.decode<SessionPayload>(req.cookies[REFRESH_COOKIE]);
    const session = await this.prisma.sesion.findUnique({ where: { id: payload.sid } });
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException();
    await this.setAccess(res, payload.sub, payload.sid, session.expiresAt);
    // La sesión conserva su vencimiento absoluto; refrescar no lo prolonga.
  }

  private async setAccess(res: Response, userId: string, sid: string, expiresAt: Date) {
    const minutes = await this.prisma.configuracion.findUnique({
      where: { clave: 'seguridad.access_minutos' },
    });
    const token = this.sign(
      userId,
      sid,
      'JWT_SECRET',
      'JWT_EXPIRES_IN',
      '15m',
      minutes ? `${(await readSettings(this.prisma))['seguridad.access_minutos']}m` : undefined,
    );
    const decoded = this.jwtService.decode<SessionPayload>(token);
    const exp = Math.min(decoded.exp, Math.floor(expiresAt.getTime() / 1000));
    this.setCookie(
      res,
      ACCESS_COOKIE,
      this.jwtService.sign(
        { sub: userId, sid, exp },
        { secret: this.config.getOrThrow<string>('JWT_SECRET') },
      ),
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
    duration?: string,
  ) {
    return this.jwtService.sign(
      { sub: userId, sid },
      {
        secret: this.config.getOrThrow<string>(secretKey),
        expiresIn: (duration ??
          this.config.get<string>(durationKey, fallback)) as JwtSignOptions['expiresIn'],
      },
    );
  }
}

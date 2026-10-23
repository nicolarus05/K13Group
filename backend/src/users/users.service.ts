import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { lockUser, verifyPassword } from './account';
import { NewPasswordDto, ProfileDto } from './users.dto';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUsername(username: string) {
    return this.prisma.usuario.findUnique({ where: { username } });
  }

  findById(id: string) {
    return this.prisma.usuario.findUnique({ where: { id } });
  }

  updateLastLogin(id: string) {
    return this.prisma.usuario.update({
      where: { id },
      data: { ultimoLogin: new Date() },
    });
  }
  async profile(id: string, dto: ProfileDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockUser(tx, id);
        const user = await verifyPassword(tx, id, dto.password);
        if (user.updatedAt.toISOString() !== dto.version)
          throw new ConflictException('El perfil ha cambiado. Recarga.');
        const updated = await tx.usuario.update({
          where: { id },
          data: { nombre: dto.nombre, username: dto.username },
          select: { id: true, nombre: true, username: true, ultimoLogin: true, updatedAt: true },
        });
        await tx.actividad.create({
          data: {
            usuarioId: id,
            tabla: 'cuenta',
            registroId: id,
            accion: 'EDITAR',
            datosAnteriores: { nombre: user.nombre, username: user.username },
            datosNuevos: { nombre: dto.nombre, username: dto.username },
          },
        });
        return updated;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Nombre de usuario ya utilizado.');
      throw e;
    }
  }
  async password(id: string, dto: NewPasswordDto) {
    if (dto.nueva !== dto.confirmacion || Buffer.byteLength(dto.nueva, 'utf8') > 72)
      throw new BadRequestException(
        'La confirmación debe coincidir y la contraseña no puede superar 72 bytes UTF-8.',
      );
    const hash = await bcrypt.hash(dto.nueva, 12);
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, id);
      await verifyPassword(tx, id, dto.password);
      await tx.usuario.update({ where: { id }, data: { passwordHash: hash } });
      await tx.sesion.deleteMany({ where: { usuarioId: id } });
      await tx.actividad.create({
        data: { usuarioId: id, tabla: 'cuenta', registroId: id, accion: 'CAMBIAR_PASSWORD' },
      });
    });
  }
  async logoutAll(id: string, password: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, id);
      await verifyPassword(tx, id, password);
      await tx.sesion.deleteMany({ where: { usuarioId: id } });
      await tx.actividad.create({
        data: { usuarioId: id, tabla: 'cuenta', registroId: id, accion: 'CERRAR_SESIONES' },
      });
    });
  }
}

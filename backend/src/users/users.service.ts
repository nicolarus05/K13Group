import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string) {
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
}

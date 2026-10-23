import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
export async function lockUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${id}::uuid FOR UPDATE`;
}
export async function verifyPassword(tx: Prisma.TransactionClient, id: string, password?: string) {
  const user = await tx.usuario.findUnique({ where: { id } });
  if (!user?.activo || !password || !(await bcrypt.compare(password, user.passwordHash)))
    throw new ForbiddenException('Contraseña actual incorrecta.');
  return user;
}

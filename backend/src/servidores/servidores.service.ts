import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateServidorDto, UpdateServidorDto } from './dto/servidor.dto';

@Injectable()
export class ServidoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() { return this.prisma.servidor.findMany({ where: { deletedAt: null }, orderBy: { nombre: 'asc' } }); }
  async create(dto: CreateServidorDto) {
    const nombre = dto.nombre.trim();
    const existing = await this.prisma.servidor.findFirst({ where: { nombre, deletedAt: null } });
    if (existing) throw new ConflictException('Ya existe un servidor con ese nombre.');
    return this.prisma.servidor.create({ data: { nombre, activo: true } });
  }
  async update(id: string, dto: UpdateServidorDto) {
    const current = await this.prisma.servidor.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Servidor ${id} no encontrado.`);
    return this.prisma.servidor.update({ where: { id }, data: { ...dto, ...(dto.nombre ? { nombre: dto.nombre.trim() } : {}) } });
  }
  async remove(id: string) {
    const current = await this.prisma.servidor.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Servidor ${id} no encontrado.`);
    return this.prisma.servidor.update({ where: { id }, data: { activo: false, deletedAt: new Date() } });
  }
}

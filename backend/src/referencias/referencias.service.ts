import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateReferenciaDto, UpdateReferenciaDto } from './dto/referencia.dto';

@Injectable()
export class ReferenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) { return this.prisma.referencia.findMany({ where: { deletedAt: null, ...(search ? { nombre: { contains: search, mode: 'insensitive' } } : {}) }, orderBy: { nombre: 'asc' } }); }
  async ensure(nombre: string) { const normalized = nombre.trim(); if (!normalized) return null; return this.prisma.referencia.upsert({ where: { nombre: normalized }, update: { activo: true, deletedAt: null }, create: { nombre: normalized, activo: true } }); }
  async create(dto: CreateReferenciaDto) {
    const nombre = dto.nombre.trim();
    const existing = await this.prisma.referencia.findFirst({ where: { nombre, deletedAt: null } });
    if (existing) throw new ConflictException('Ya existe una referencia con ese nombre.');
    return this.prisma.referencia.create({ data: { ...dto, nombre, activo: true } });
  }
  async update(id: string, dto: UpdateReferenciaDto) {
    const current = await this.prisma.referencia.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Referencia ${id} no encontrada.`);
    return this.prisma.referencia.update({ where: { id }, data: { ...dto, ...(dto.nombre ? { nombre: dto.nombre.trim() } : {}) } });
  }
  async remove(id: string) {
    const current = await this.prisma.referencia.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Referencia ${id} no encontrada.`);
    return this.prisma.referencia.update({ where: { id }, data: { activo: false, deletedAt: new Date() } });
  }
}

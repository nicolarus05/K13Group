import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateProductoDto, UpdateProductoDto } from './dto/producto.dto';

@Injectable()
export class ProductosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) {
    return this.prisma.producto.findMany({
      where: { deletedAt: null, ...(search ? { nombre: { contains: search, mode: 'insensitive' } } : {}) },
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { tarifas: true, suscripciones: true } } },
    });
  }

  async create(dto: CreateProductoDto) {
    const nombre = dto.nombre.trim();
    const existing = await this.prisma.producto.findFirst({ where: { nombre, deletedAt: null } });
    if (existing) throw new ConflictException('Ya existe un producto con ese nombre.');
    return this.prisma.producto.create({ data: { ...dto, nombre } });
  }

  async update(id: string, dto: UpdateProductoDto) {
    const current = await this.prisma.producto.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Producto ${id} no encontrado.`);
    if (dto.nombre && dto.nombre.trim() !== current.nombre) {
      const duplicate = await this.prisma.producto.findFirst({ where: { nombre: dto.nombre.trim(), deletedAt: null, NOT: { id } } });
      if (duplicate) throw new ConflictException('Ya existe un producto con ese nombre.');
    }
    return this.prisma.producto.update({ where: { id }, data: { ...dto, ...(dto.nombre ? { nombre: dto.nombre.trim() } : {}) } });
  }

  async remove(id: string) {
    const current = await this.prisma.producto.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Producto ${id} no encontrado.`);
    return this.prisma.producto.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
  }
}

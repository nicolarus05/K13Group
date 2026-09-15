import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateTarifaDto, UpdateTarifaDto } from './dto/tarifa.dto';

@Injectable()
export class TarifasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(productoId?: string) {
    return this.prisma.tarifa.findMany({ where: { activo: true, ...(productoId ? { productoId } : {}) }, include: { producto: true }, orderBy: [{ producto: { nombre: 'asc' } }, { precio: 'asc' }] });
  }

  async create(dto: CreateTarifaDto) {
    const product = await this.prisma.producto.findFirst({ where: { id: dto.productoId, activo: true, deletedAt: null } });
    if (!product) throw new NotFoundException('Producto no encontrado o inactivo.');
    const duplicate = await this.prisma.tarifa.findFirst({ where: { productoId: dto.productoId, nombre: dto.nombre.trim(), activo: true } });
    if (duplicate) throw new ConflictException('Ya existe una tarifa con ese nombre para el producto.');
    return this.prisma.tarifa.create({ data: { ...dto, nombre: dto.nombre.trim() }, include: { producto: true } });
  }

  async update(id: string, dto: UpdateTarifaDto) {
    const current = await this.prisma.tarifa.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Tarifa ${id} no encontrada.`);
    return this.prisma.tarifa.update({ where: { id }, data: { ...dto, ...(dto.nombre ? { nombre: dto.nombre.trim() } : {}) }, include: { producto: true } });
  }

  async remove(id: string) {
    const current = await this.prisma.tarifa.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Tarifa ${id} no encontrada.`);
    return this.prisma.tarifa.update({ where: { id }, data: { activo: false } });
  }
}

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FindClientesDto } from './dto/find-clientes.dto';
import { normalizePhone } from '../common/helpers/normalization';

const INCLUDE_ESTADO = { estado: true } satisfies Prisma.ClienteInclude;

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindClientesDto) {
    const { page = 1, search, estadoId } = query;
    const limit = Math.min(query.limit ?? 25, 100);
    const allowedSorts = new Set(['nombre', 'createdAt', 'updatedAt']);
    const sort = allowedSorts.has(query.sort ?? '') ? query.sort! : 'nombre';
    const skip = (page - 1) * limit;

    const where: Prisma.ClienteWhereInput = {
      deletedAt: null,
      ...(estadoId && { estadoId }),
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' } },
          { telefono: { contains: search, mode: 'insensitive' } },
          { telefonoNormalizado: { contains: normalizePhone(search) ?? search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: 'asc' },
        include: INCLUDE_ESTADO,
      }),
      this.prisma.cliente.count({ where }),
    ]);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...INCLUDE_ESTADO,
        suscripciones: {
          where: { deletedAt: null },
          include: {
            producto: true,
            tarifa: true,
            servidor: true,
            referencia: true,
            estado: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cliente) throw new NotFoundException(`Cliente ${id} no encontrado`);
    return cliente;
  }

  async create(dto: CreateClienteDto) {
    const telefono = dto.telefono?.trim() || null;
    const telefonoNormalizado = normalizePhone(telefono);

    // RN-001.003: teléfono normalizado único si se proporciona
    if (telefonoNormalizado) {
      const existe = await this.prisma.cliente.findFirst({
        where: {
          deletedAt: null,
          OR: [{ telefonoNormalizado }, { telefono: telefonoNormalizado }, { telefono }],
        },
      });
      if (existe) throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    const estadoActivo = await this.prisma.estado.findFirstOrThrow({
      where: { tipo: 'cliente', valor: 'ACTIVO' },
    });

    const cliente = await this.prisma.cliente.create({
      data: { ...dto, telefono, telefonoNormalizado, estadoId: estadoActivo.id },
      include: INCLUDE_ESTADO,
    });
    await this.ensureReferencia(cliente.nombre);
    return cliente;
  }

  async update(id: string, dto: UpdateClienteDto) {
    await this.findOne(id);

    const hasTelefono = dto.telefono !== undefined;
    const telefono = hasTelefono ? dto.telefono?.trim() || null : undefined;
    const telefonoNormalizado = hasTelefono ? normalizePhone(telefono) : undefined;

    // RN-001.003: teléfono normalizado único si se proporciona
    if (telefonoNormalizado) {
      const existe = await this.prisma.cliente.findFirst({
        where: {
          deletedAt: null,
          NOT: { id },
          OR: [{ telefonoNormalizado }, { telefono: telefonoNormalizado }, { telefono }],
        },
      });
      if (existe) throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    const cliente = await this.prisma.cliente.update({
      where: { id },
      data: { ...dto, ...(hasTelefono ? { telefono, telefonoNormalizado } : {}) },
      include: INCLUDE_ESTADO,
    });
    if (dto.nombre) await this.ensureReferencia(cliente.nombre);
    return cliente;
  }

  // RN-001.004: borrado lógico
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.cliente.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async ensureReferencia(nombre: string) {
    const value = nombre.trim();
    if (!value) return;
    await this.prisma.referencia.upsert({
      where: { nombre: value },
      update: { activo: true, deletedAt: null },
      create: { nombre: value, activo: true },
    });
  }
}

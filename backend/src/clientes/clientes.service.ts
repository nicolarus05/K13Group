import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FindClientesDto } from './dto/find-clientes.dto';

const INCLUDE_ESTADO = { estado: true } satisfies Prisma.ClienteInclude;

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindClientesDto) {
    const { page = 1, limit = 25, search, estadoId, sort = 'nombre' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ClienteWhereInput = {
      deletedAt: null,
      ...(estadoId && { estadoId }),
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' } },
          { telefono: { contains: search, mode: 'insensitive' } },
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

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
    // RN-001.003: teléfono único si se proporciona
    if (dto.telefono) {
      const existe = await this.prisma.cliente.findFirst({
        where: { telefono: dto.telefono, deletedAt: null },
      });
      if (existe) throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    const estadoActivo = await this.prisma.estado.findFirstOrThrow({
      where: { tipo: 'cliente', valor: 'ACTIVO' },
    });

    return this.prisma.cliente.create({
      data: { ...dto, estadoId: estadoActivo.id },
      include: INCLUDE_ESTADO,
    });
  }

  async update(id: string, dto: UpdateClienteDto) {
    await this.findOne(id);

    // RN-001.003: teléfono único si se proporciona
    if (dto.telefono) {
      const existe = await this.prisma.cliente.findFirst({
        where: { telefono: dto.telefono, deletedAt: null, NOT: { id } },
      });
      if (existe) throw new ConflictException('Ya existe un cliente con ese teléfono');
    }

    return this.prisma.cliente.update({
      where: { id },
      data: dto,
      include: INCLUDE_ESTADO,
    });
  }

  // RN-001.004: borrado lógico
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.cliente.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

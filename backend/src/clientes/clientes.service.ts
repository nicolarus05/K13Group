import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FindClientesDto } from './dto/find-clientes.dto';
import { normalizeComparable, normalizePhone } from '../common/helpers/normalization';
import { lockCatalog } from '../catalogos/catalogos.service';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { subscriptionSelect } from '../suscripciones/subscription.select';

const INCLUDE_ESTADO = { estado: true } satisfies Prisma.ClienteInclude;

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SuscripcionesService,
  ) {}

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
          select: subscriptionSelect,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cliente) throw new NotFoundException(`Cliente ${id} no encontrado`);
    return {
      ...cliente,
      suscripciones: await this.subscriptions.currentStates(cliente.suscripciones),
    };
  }

  async create(dto: CreateClienteDto, usuarioId: string) {
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

    return this.prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: { ...dto, telefono, telefonoNormalizado, estadoId: estadoActivo.id },
        include: INCLUDE_ESTADO,
      });
      await this.ensureReferencia(tx, cliente.nombre, usuarioId);
      await tx.actividad.create({
        data: { usuarioId, tabla: 'clientes', registroId: cliente.id, accion: 'CREAR' },
      });
      return cliente;
    });
  }

  async update(id: string, dto: UpdateClienteDto, usuarioId: string) {
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

    return this.prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.update({
        where: { id },
        data: { ...dto, ...(hasTelefono ? { telefono, telefonoNormalizado } : {}) },
        include: INCLUDE_ESTADO,
      });
      if (dto.nombre) await this.ensureReferencia(tx, cliente.nombre, usuarioId);
      await tx.actividad.create({
        data: { usuarioId, tabla: 'clientes', registroId: id, accion: 'EDITAR' },
      });
      return cliente;
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

  private async ensureReferencia(tx: Prisma.TransactionClient, nombre: string, usuarioId: string) {
    await lockCatalog(tx, 'referencias');
    const value = nombre.trim().replace(/\s+/g, ' ');
    const references = await tx.referencia.findMany({ select: { id: true, nombre: true } });
    if (references.some((item) => normalizeComparable(item.nombre) === normalizeComparable(value)))
      return;
    const reference = await tx.referencia.create({ data: { nombre: value, activo: true } });
    await tx.actividad.create({
      data: {
        usuarioId,
        tabla: 'referencias',
        registroId: reference.id,
        accion: 'CREAR',
        datosNuevos: { nombre: value, origen: 'CLIENTE' },
      },
    });
  }
}

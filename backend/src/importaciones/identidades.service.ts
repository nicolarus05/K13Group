import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { normalizeName } from '../common/helpers/normalization';
import { DecidirIdentidadDto, IdentidadesQueryDto } from './dto/identidades.dto';
import {
  identityData,
  identityHash,
  identityMatch,
  identityPhone,
  identityProblems,
  IdentityData,
} from './identity-matching';

const clientSelect = {
  id: true,
  nombre: true,
  telefono: true,
  email: true,
  observaciones: true,
  estadoId: true,
  updatedAt: true,
  deletedAt: true,
} as const;
const rowSelect = {
  id: true,
  hojaOrigen: true,
  filaOrigen: true,
  version: true,
  datosNormalizados: true,
  lectura: true,
} as const;
type Client = Prisma.ClienteGetPayload<{ select: typeof clientSelect }>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const history = (value: Prisma.JsonValue) => (Array.isArray(value) ? value : []);

@Injectable()
export class IdentidadesService {
  constructor(private readonly prisma: PrismaService) {}

  private async parent(tx: Prisma.TransactionClient, id: string, lock = false) {
    if (lock) await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
    const parent = await tx.importacion.findUnique({ where: { id } });
    if (!parent) throw new NotFoundException('Análisis no encontrado.');
    if (!parent.versionMapeo.startsWith('12.1.') || parent.estado !== 'EN_REVISION')
      throw new ConflictException(
        'La revisión de identidades requiere una lectura 12.1 en revisión.',
      );
    return parent;
  }

  async prepare(id: string, actor: string) {
    await this.prisma.$transaction(
      async (tx) => {
        const parent = await this.parent(tx, id, true);
        if (parent.versionIdentidades) return;
        const rows = await tx.importacionFila.findMany({
          where: { importacionId: id },
          select: rowSelect,
        });
        await tx.importacionIdentidad.createMany({
          data: rows.map((row) => ({
            id: row.id,
            importacionId: id,
            datos: json(identityData(row.datosNormalizados)),
            historial: [],
          })),
        });
        await tx.$executeRaw`UPDATE importacion_filas SET identidad_id=id WHERE importacion_id=${id}::uuid`;
        await tx.importacion.update({ where: { id }, data: { versionIdentidades: 1 } });
        await tx.actividad.create({
          data: {
            usuarioId: actor,
            tabla: 'importaciones',
            registroId: id,
            accion: 'PREPARAR_IDENTIDADES',
            datosNuevos: { filas: rows.length, version: 1 },
          },
        });
      },
      { timeout: 30000 },
    );
    return { preparado: true };
  }

  async context(tx: Prisma.TransactionClient, id: string) {
    const groups = await tx.importacionIdentidad.findMany({
      where: { importacionId: id, filas: { some: {} } },
      include: {
        filas: { select: rowSelect, orderBy: [{ hojaOrigen: 'asc' }, { filaOrigen: 'asc' }] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const clients = await tx.cliente.findMany({ select: clientSelect });
    const byId = new Map(clients.map((c) => [c.id, c]));
    const byPhone = new Map<string, Array<{ id: string; name: string; kind: string }>>();
    const byName = new Map<string, Set<string>>();
    const emailsByKey = new Map<string, Set<string>>();
    const index = (id: string, data: IdentityData, kind: string) => {
      const phone = identityPhone(data.telefono),
        name = normalizeName(data.nombre);
      if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), { id, name, kind }]);
      if (name && phone) byName.set(name, new Set([...(byName.get(name) ?? []), phone]));
      if (data.email)
        for (const key of [phone ? `phone:${phone}` : null, name ? `name:${name}` : null]) {
          if (key)
            emailsByKey.set(
              key,
              new Set([...(emailsByKey.get(key) ?? []), data.email.toLowerCase()]),
            );
        }
    };
    for (const c of clients) if (!c.deletedAt) index(c.id, identityData(c), 'CLIENTE');
    for (const g of groups)
      if (g.estado !== 'EXCLUIDO') index(g.id, identityData(g.datos), g.estado);
    const statuses = new Map<string, string>();
    const reasons = new Map<string, string[]>();
    for (const g of groups) {
      const data = identityData(g.datos),
        phone = identityPhone(data.telefono),
        name = normalizeName(data.nombre);
      const why: string[] = [];
      if (g.estado === 'VINCULADO') {
        const client = byId.get(g.clienteDestinoId ?? '');
        if (!client || client.deletedAt || identityHash(client) !== g.huellaCliente)
          why.push(
            'El cliente de destino ha cambiado o ya no está disponible. Revisa la vinculación.',
          );
      }
      if (
        g.estado === 'NUEVO' &&
        phone &&
        byPhone.get(phone)?.some((x) => x.id !== g.id && ['CLIENTE', 'NUEVO'].includes(x.kind))
      )
        why.push('El teléfono ya pertenece a un cliente o a otra propuesta de cliente nuevo.');
      if (g.estado === 'PENDIENTE') {
        why.push(...identityProblems(data));
        if (phone && byPhone.get(phone)?.some((x) => x.id !== g.id && x.name !== name))
          why.push('Mismo teléfono con nombres distintos.');
        if (name && (byName.get(name)?.size ?? 0) > 1)
          why.push('Mismo nombre con teléfonos distintos.');
        if (
          (phone && (emailsByKey.get(`phone:${phone}`)?.size ?? 0) > 1) ||
          (name && (emailsByKey.get(`name:${name}`)?.size ?? 0) > 1)
        )
          why.push('Coincidencia de nombre o teléfono con emails distintos.');
        const sources = g.filas.map((r) => identityData(r.datosNormalizados));
        if (
          sources.some((s) => identityProblems(s).length) ||
          new Set(sources.map((s) => normalizeName(s.nombre)).filter(Boolean)).size > 1 ||
          new Set(sources.map((s) => identityPhone(s.telefono)).filter(Boolean)).size > 1 ||
          new Set(sources.map((s) => s.email?.toLowerCase()).filter(Boolean)).size > 1
        )
          why.push(
            'Las filas agrupadas contienen datos de cliente incompletos, inválidos o distintos. Revisa la comparación.',
          );
      }
      if (g.estado === 'REVISAR')
        why.push('Han cambiado datos de lectura utilizados en esta decisión.');
      statuses.set(
        g.id,
        why.length ? (g.estado === 'PENDIENTE' ? 'CONFLICTO' : 'REVISAR') : g.estado,
      );
      reasons.set(g.id, why);
    }
    return { groups, clients, statuses, reasons };
  }

  async list(id: string, query: IdentidadesQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const parent = await this.parent(tx, id);
        const { groups, clients, statuses, reasons } = await this.context(tx, id);
        const counts: Record<string, number> = {
          PENDIENTE: 0,
          CONFLICTO: 0,
          REVISAR: 0,
          NUEVO: 0,
          VINCULADO: 0,
          EXCLUIDO: 0,
        };
        for (const s of statuses.values()) counts[s] = (counts[s] ?? 0) + 1;
        const search = (query.buscar ?? '').trim().toUpperCase();
        const filtered = groups.filter(
          (g) =>
            (!query.estado || statuses.get(g.id) === query.estado) &&
            (!query.identidadId || g.id === query.identidadId) &&
            (!search ||
              [
                identityData(g.datos).nombre,
                identityData(g.datos).telefono,
                ...g.filas.flatMap((r) => [
                  identityData(r.datosNormalizados).nombre,
                  identityData(r.datosNormalizados).telefono,
                  `${r.hojaOrigen} ${r.filaOrigen}`,
                ]),
              ].some((v) => v?.toUpperCase().includes(search))),
        );
        const data = filtered
          .slice((query.page - 1) * query.limit, query.page * query.limit)
          .map((g) => {
            const source = identityData(g.datos);
            const candidates = groups
              .filter((other) => other.id !== g.id && other.estado !== 'EXCLUIDO')
              .flatMap((other) => {
                const reason = identityMatch(source, identityData(other.datos));
                return reason
                  ? [
                      {
                        id: other.id,
                        nombre: identityData(other.datos).nombre,
                        telefono: identityData(other.datos).telefono,
                        datos: identityData(other.datos),
                        motivo: reason,
                        filas: other.filas.map((r) => ({
                          id: r.id,
                          hoja: r.hojaOrigen,
                          fila: r.filaOrigen,
                        })),
                      },
                    ]
                  : [];
              })
              .sort(
                (a, b) =>
                  Number(a.motivo.startsWith('Nombres')) - Number(b.motivo.startsWith('Nombres')) ||
                  a.id.localeCompare(b.id),
              );
            const matches = clients
              .filter((c) => !c.deletedAt)
              .flatMap((c) => {
                const reason = identityMatch(source, identityData(c));
                return reason ? [{ ...this.publicClient(c), motivo: reason }] : [];
              })
              .sort(
                (a, b) =>
                  Number(a.motivo.startsWith('Nombres')) - Number(b.motivo.startsWith('Nombres')) ||
                  a.id.localeCompare(b.id),
              );
            const target = clients.find((c) => c.id === g.clienteDestinoId);
            return {
              id: g.id,
              estado: statuses.get(g.id),
              decision: g.estado,
              datos: source,
              problemas: reasons.get(g.id),
              clienteDestino: target ? this.publicClient(target) : null,
              filas: g.filas.map((r) => ({
                id: r.id,
                hoja: r.hojaOrigen,
                fila: r.filaOrigen,
                version: r.version,
                datos: identityData(r.datosNormalizados),
                originales: Object.fromEntries(
                  ['NOMBRE', 'TELEFONO', 'EMAIL', 'OBSERV'].map((key) => {
                    const cell = (
                      r.lectura as {
                        campos?: Record<string, { valor: Prisma.JsonValue; celda: string | null }>;
                      } | null
                    )?.campos?.[key];
                    return [key, { valor: cell?.valor ?? null, celda: cell?.celda ?? null }];
                  }),
                ),
              })),
              candidatos: candidates.slice(0, 20),
              totalCandidatos: candidates.length,
              clientes: matches.slice(0, 20),
              totalClientes: matches.length,
              historial: g.historial,
            };
          });
        return {
          preparado: parent.versionIdentidades > 0,
          version: parent.versionIdentidades,
          resumen: counts,
          filas: parent.registros,
          data,
          pagination: {
            page: query.page,
            limit: query.limit,
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / query.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }

  private publicClient(c: Client) {
    return {
      id: c.id,
      ...identityData(c),
      eliminado: Boolean(c.deletedAt),
      huella: identityHash(c),
    };
  }

  async clients(id: string, query: IdentidadesQueryDto) {
    await this.parent(this.prisma, id);
    const term = query.buscar?.trim();
    const where: Prisma.ClienteWhereInput = {
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { nombre: { contains: term, mode: 'insensitive' } },
              { telefono: { contains: term } },
              { telefonoNormalizado: { contains: term.replace(/\D/g, '') || '__sin_telefono__' } },
            ],
          }
        : {}),
    };
    const [clients, total] = await this.prisma.$transaction([
      this.prisma.cliente.findMany({
        where,
        select: clientSelect,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.cliente.count({ where }),
    ]);
    return {
      data: clients.map((c) => this.publicClient(c)),
      pagination: { total, page: query.page, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async decide(id: string, actor: string, dto: DecidirIdentidadDto) {
    const hash = identityHash({ actor, ...dto, filas: [...dto.filas].sort() });
    return this.prisma.$transaction(
      async (tx) => {
        const parent = await this.parent(tx, id, true);
        const replay = await tx.importacionIdentidad.findUnique({
          where: { solicitudId: dto.solicitudId },
        });
        if (replay) {
          if (replay.importacionId !== id || replay.solicitudHash !== hash)
            throw new ConflictException('La solicitud ya se utilizó con otra decisión.');
          return { id: replay.id, version: parent.versionIdentidades };
        }
        if (parent.versionIdentidades !== dto.version)
          throw new ConflictException(
            'La revisión ha cambiado. Recarga las identidades; tu borrador se conserva.',
          );
        const rows = await tx.importacionFila.findMany({
          where: { importacionId: id, id: { in: dto.filas } },
          select: { ...rowSelect, identidadId: true },
        });
        if (rows.length !== dto.filas.length || rows.some((r) => !r.identidadId))
          throw new BadRequestException('Selecciona filas de esta revisión preparada.');
        const previousIds = [...new Set(rows.map((r) => r.identidadId!))];
        let canonical = identityData(rows[0].datosNormalizados);
        let target: Client | null = null;
        if (dto.accion === 'NUEVO') {
          if (
            !dto.datos ||
            Object.keys(dto.datos).some(
              (k) => !['nombre', 'telefono', 'email', 'observaciones'].includes(k),
            ) ||
            ['nombre', 'telefono', 'email', 'observaciones'].some(
              (k) =>
                !(k in dto.datos!) || (dto.datos![k] !== null && typeof dto.datos![k] !== 'string'),
            )
          )
            throw new BadRequestException(
              'Indica nombre, teléfono, email y observaciones; usa null para datos ausentes.',
            );
          canonical = identityData(dto.datos);
          const errors = identityProblems(canonical);
          if (errors.length) throw new BadRequestException(errors);
          const phone = identityPhone(canonical.telefono);
          if (phone) {
            const existing = await tx.cliente.findFirst({
              where: { deletedAt: null, telefonoNormalizado: phone },
              select: { id: true },
            });
            const others = await tx.importacionIdentidad.findMany({
              where: {
                importacionId: id,
                estado: 'NUEVO',
                // Los grupos afectados quedan pendientes al separar sus filas.
                id: { notIn: previousIds },
                filas: { some: { id: { notIn: dto.filas } } },
              },
              select: { datos: true },
            });
            if (
              existing ||
              others.some((g) => identityPhone(identityData(g.datos).telefono) === phone)
            )
              throw new ConflictException(
                'Teléfono ocupado por un cliente o por otra propuesta. Revisa la agrupación o vinculación.',
              );
          }
        } else if (dto.accion === 'VINCULAR') {
          if (!dto.clienteDestinoId || !dto.huellaCliente)
            throw new BadRequestException('Selecciona y revisa el cliente de destino.');
          await tx.$queryRaw`SELECT id FROM clientes WHERE id=${dto.clienteDestinoId}::uuid FOR SHARE`;
          target = await tx.cliente.findUnique({
            where: { id: dto.clienteDestinoId },
            select: clientSelect,
          });
          if (!target || target.deletedAt || identityHash(target) !== dto.huellaCliente)
            throw new ConflictException(
              'El cliente de destino ha cambiado. Vuelve a seleccionarlo.',
            );
          canonical = identityData(target);
        }
        const previous = await tx.importacionIdentidad.findMany({
          where: { id: { in: previousIds } },
          include: { filas: { select: rowSelect } },
        });
        const user = await tx.usuario.findUniqueOrThrow({
          where: { id: actor },
          select: { nombre: true },
        });
        const event = {
          id: randomUUID(),
          autor: user.nombre,
          usuarioId: actor,
          fecha: new Date().toISOString(),
          motivo: dto.motivo,
          accion: dto.accion,
          filas: dto.filas,
          anteriores: previous.map((g) => ({
            id: g.id,
            estado: g.estado,
            datos: g.datos,
            clienteDestinoId: g.clienteDestinoId,
          })),
          datos: canonical,
          clienteDestinoId: target?.id ?? null,
        };
        const inherited = [
          ...new Map(
            previous.flatMap((g) => history(g.historial)).map((e) => [(e as { id: string }).id, e]),
          ).values(),
        ];
        const group = await tx.importacionIdentidad.create({
          data: {
            importacionId: id,
            estado: (
              {
                NUEVO: 'NUEVO',
                VINCULAR: 'VINCULADO',
                PENDIENTE: 'PENDIENTE',
                EXCLUIR: 'EXCLUIDO',
              } as const
            )[dto.accion],
            datos: json(canonical),
            clienteDestinoId: target?.id,
            huellaCliente: target ? identityHash(target) : null,
            historial: json([...inherited, event]),
            solicitudId: dto.solicitudId,
            solicitudHash: hash,
          },
        });
        await tx.importacionFila.updateMany({
          where: { id: { in: dto.filas }, importacionId: id },
          data: { identidadId: group.id },
        });
        for (const g of previous) {
          const remaining = g.filas.filter((r) => !dto.filas.includes(r.id));
          await tx.importacionIdentidad.update({
            where: { id: g.id },
            data: {
              historial: json([
                ...history(g.historial),
                {
                  ...event,
                  id: randomUUID(),
                  decisionId: event.id,
                  accion: 'SEPARAR_FILAS',
                },
              ]),
              ...(remaining.length
                ? {
                    estado: 'PENDIENTE',
                    datos: json(identityData(remaining[0].datosNormalizados)),
                    clienteDestinoId: null,
                    huellaCliente: null,
                  }
                : {}),
            },
          });
        }
        const updated = await tx.importacion.update({
          where: { id },
          data: { versionIdentidades: { increment: 1 } },
        });
        await tx.actividad.create({
          data: {
            usuarioId: actor,
            tabla: 'importacion_identidades',
            registroId: group.id,
            accion: 'DECIDIR_IDENTIDAD',
            datosNuevos: json(event),
          },
        });
        return { id: group.id, version: updated.versionIdentidades };
      },
      { timeout: 30000 },
    );
  }
}

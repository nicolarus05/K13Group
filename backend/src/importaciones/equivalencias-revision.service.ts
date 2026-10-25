import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { normalizeComparable } from '../common/helpers/normalization';
import { IdentidadesService } from './identidades.service';
import { identityData, identityHash } from './identity-matching';
import { annualStart, equivalenceSource, record } from './equivalence-rules';
import { RowReading } from './excel-validation';
import {
  DecidirEquivalenciaDto,
  EquivalenciasQueryDto,
  EquivalenceType,
  EQUIVALENCE_TYPES,
} from './dto/equivalencias-revision.dto';

type Catalog = {
  id: string;
  nombre: string;
  activo: boolean;
  huella: string;
  productoId?: string;
  duracionMeses?: number;
  precio?: number;
  esGratuito?: boolean;
};
type Decision = Prisma.ImportacionEquivalenciaRevisionGetPayload<object>;
type Source = ReturnType<typeof equivalenceSource>;
type Cell = Source & {
  estado: string;
  destino: Catalog | null;
  sugerencias: Catalog[];
  alcance: string | null;
  decisionId: string | null;
  motivo: string | null;
};
const json = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class EquivalenciasRevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: IdentidadesService,
  ) {}

  async context(tx: Prisma.TransactionClient, id: string, lock = false) {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
      // Estabiliza los destinos entre la validación y el guardado de su huella.
      await tx.$queryRaw`SELECT id FROM productos FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM tarifas FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM servidores FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM referencias FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM metodos_pago FOR SHARE`;
    }
    const parent = await tx.importacion.findUnique({ where: { id } });
    if (!parent) throw new NotFoundException('Análisis no encontrado.');
    if (!parent.versionMapeo.startsWith('12.1.') || parent.estado !== 'EN_REVISION')
      throw new ConflictException('Las equivalencias requieren una lectura 12.1 en revisión.');
    const [rows, decisions, products, tariffs, servers, references, payments, legacy, identities] =
      await Promise.all([
        tx.importacionFila.findMany({
          where: { importacionId: id },
          orderBy: [{ hojaOrigen: 'asc' }, { filaOrigen: 'asc' }],
        }),
        tx.importacionEquivalenciaRevision.findMany({
          where: { importacionId: id },
          orderBy: { version: 'asc' },
        }),
        tx.producto.findMany({ orderBy: { id: 'asc' } }),
        tx.tarifa.findMany({ include: { producto: true }, orderBy: { id: 'asc' } }),
        tx.servidor.findMany({ orderBy: { id: 'asc' } }),
        tx.referencia.findMany({ orderBy: { id: 'asc' } }),
        tx.metodoPago.findMany({ orderBy: { id: 'asc' } }),
        tx.importacionEquivalencia.findMany({ where: { activo: true } }),
        this.identities.context(tx, id),
      ]);
    const catalog = (v: { id: string; nombre: string; activo: boolean }): Catalog => ({
      id: v.id,
      nombre: v.nombre,
      activo: v.activo,
      huella: identityHash(v),
    });
    const catalogs: Record<EquivalenceType, Catalog[]> = {
      PRODUCTO: products.filter((p) => p.activo && !p.deletedAt).map(catalog),
      TARIFA: tariffs
        .filter(
          (t) => t.activo && t.producto.activo && !t.producto.deletedAt && t.duracionMeses === 12,
        )
        .map((t) => ({
          ...catalog(t),
          productoId: t.productoId,
          duracionMeses: t.duracionMeses,
          precio: Number(t.precio),
        })),
      SERVIDOR: servers
        .filter(
          (s) =>
            !s.deletedAt &&
            (s.activo || ['COBRA', 'PROMAX'].includes(normalizeComparable(s.nombre))),
        )
        .map(catalog),
      REFERENCIA: references.filter((r) => r.activo && !r.deletedAt).map(catalog),
      PAGO: payments
        .filter((p) => p.activo && !p.deletedAt && normalizeComparable(p.nombre) !== 'PA')
        .map((p) => ({ ...catalog(p), esGratuito: p.esGratuito })),
    };
    const latest = new Map<string, Decision>();
    // Los catálogos pueden contener miles de referencias. Indexar una vez evita
    // normalizar y recorrer todo el catálogo por cada celda del archivo.
    const catalogIds = new Map<string, Catalog>();
    const catalogNames = new Map<string, Catalog[]>();
    const catalogOrder = new Map<string, number>();
    const tariffPrices = new Map<string, Catalog[]>();
    for (const type of EQUIVALENCE_TYPES)
      catalogs[type].forEach((item, index) => {
        catalogIds.set(`${type}:${item.id}`, item);
        catalogOrder.set(`${type}:${item.id}`, index);
        const key = `${type}:${normalizeComparable(item.nombre)}`;
        catalogNames.set(key, [...(catalogNames.get(key) ?? []), item]);
        if (type === 'TARIFA') {
          const priceKey = `${item.productoId}:${item.precio}`;
          tariffPrices.set(priceKey, [...(tariffPrices.get(priceKey) ?? []), item]);
        }
      });
    const legacyIds = new Map<string, string[]>();
    for (const mapping of legacy) {
      if (!mapping.entidadId) continue;
      const key = `${mapping.tipo}:${mapping.valorClave}`;
      legacyIds.set(key, [...(legacyIds.get(key) ?? []), mapping.entidadId]);
    }
    const lastValueForRow = new Map<string, Decision>();
    for (const d of decisions) {
      latest.set(`${d.tipo}:${d.alcance}:${d.filaId ?? d.clave}`, d);
      if (d.alcance === 'VALOR')
        for (const rowId of Object.keys(record(d.dependencias)))
          lastValueForRow.set(`${d.tipo}:${rowId}`, d);
    }
    const resolve = (
      row: (typeof rows)[number],
      tipo: EquivalenceType,
      source: Source,
      product?: Catalog | null,
    ): Cell => {
      const override = latest.get(`${tipo}:FILA:${row.id}`);
      const d =
        override && override.accion !== 'HEREDAR'
          ? override
          : (latest.get(`${tipo}:VALOR:${source.clave}`) ??
            lastValueForRow.get(`${tipo}:${row.id}`));
      const target = catalogIds.get(`${tipo}:${d?.entidadId}`) ?? null;
      const eligible = (c: Catalog) =>
        tipo !== 'TARIFA' || (product && c.productoId === product.id && c.duracionMeses === 12);
      const data = record(row.datosNormalizados);
      const legacyKey =
        tipo === 'TARIFA' ? `${data.productoClave}|${data.importeAnual}` : source.etiqueta;
      const candidates = [
        ...(catalogNames.get(`${tipo}:${source.etiqueta}`) ?? []),
        ...(legacyIds.get(`${tipo}:${legacyKey}`) ?? []).flatMap((id) => {
          const item = catalogIds.get(`${tipo}:${id}`);
          return item ? [item] : [];
        }),
        ...(tipo === 'TARIFA' && product && typeof data.importeAnual === 'number'
          ? (tariffPrices.get(`${product.id}:${data.importeAnual}`) ?? [])
          : []),
      ];
      const suggestions = [...new Map(candidates.map((c) => [c.id, c])).values()]
        .filter(eligible)
        .sort(
          (a, b) => catalogOrder.get(`${tipo}:${a.id}`)! - catalogOrder.get(`${tipo}:${b.id}`)!,
        );
      let estado = source.ignorado
        ? 'IGNORADO'
        : tipo === 'REFERENCIA' && source.ausente
          ? 'SIN_DATO'
          : 'PENDIENTE';
      if (!source.ignorado && d && d.accion !== 'HEREDAR') {
        const stale = record(d.dependencias)[row.id] !== source.dependencia;
        estado = stale
          ? 'REVISAR'
          : d.accion === 'PENDIENTE'
            ? 'PENDIENTE'
            : !target || !eligible(target) || d.huellaDestino !== target.huella
              ? 'REVISAR'
              : !target.activo
                ? d.historico
                  ? 'HISTORICA'
                  : 'REVISAR'
                : 'RESUELTA';
      }
      return {
        ...source,
        estado,
        destino: target,
        sugerencias: source.ignorado || source.ausente ? [] : suggestions,
        alcance: d?.alcance ?? null,
        decisionId: d?.id ?? null,
        motivo: d?.motivo ?? null,
      };
    };
    const groups = new Map(identities.groups.map((g) => [g.id, g]));
    const reviewRow = (row: (typeof rows)[number]) => {
      const product = resolve(row, 'PRODUCTO', equivalenceSource(row, 'PRODUCTO'));
      const validProduct = product.estado === 'RESUELTA' ? product.destino : null;
      const cells = { PRODUCTO: product } as Record<EquivalenceType, Cell>;
      for (const type of EQUIVALENCE_TYPES.filter((t) => t !== 'PRODUCTO'))
        cells[type] = resolve(
          row,
          type,
          equivalenceSource(
            row,
            type,
            validProduct
              ? {
                  id: validProduct.id,
                  nombre: validProduct.nombre,
                  huella: identityHash([
                    validProduct.huella,
                    product.decisionId,
                    product.dependencia,
                  ]),
                }
              : undefined,
          ),
          validProduct,
        );
      const data = record(row.datosNormalizados);
      const group = groups.get(row.identidadId ?? '');
      const identity = identities.statuses.get(row.identidadId ?? '') ?? 'PENDIENTE';
      const excluded = identity === 'EXCLUIDO';
      const issues = (row.lectura as unknown as RowReading)?.incidencias ?? [];
      const dateIssues = issues.filter((i) => i.campo === 'FECHA');
      const start = dateIssues.length ? null : annualStart(data.fecha);
      const subscriptionReady =
        ['PRODUCTO', 'TARIFA', 'SERVIDOR'].every((t) =>
          ['RESUELTA', 'HISTORICA'].includes(cells[t as EquivalenceType].estado),
        ) &&
        ['RESUELTA', 'SIN_DATO'].includes(cells.REFERENCIA.estado) &&
        start;
      const payment = cells.PAGO;
      const amount = typeof data.importeAnual === 'number' ? data.importeAnual : null;
      const contradiction =
        payment.destino &&
        ((payment.destino.esGratuito && amount !== 0) ||
          (!payment.destino.esGratuito && amount === 0));
      const finance =
        data.estadoPago === 'PENDIENTE'
          ? 'PENDIENTE_PAGO'
          : payment.estado !== 'RESUELTA' ||
              amount === null ||
              amount < 0 ||
              contradiction ||
              issues.some(
                (i) =>
                  ['PANO', 'ESTADO'].includes(i.campo) &&
                  i.ambito === 'FINANZAS' &&
                  !['CERO_NO_GRATUITO', 'GRATIS_CON_IMPORTE'].includes(i.codigo),
              )
            ? 'PENDIENTE'
            : payment.destino?.esGratuito
              ? 'GRATUITO'
              : 'PENDIENTE_CONFIRMACION';
      const warnings = dateIssues.map((i) => i.mensaje);
      if (contradiction) warnings.push('El importe anual contradice el método gratuito/de pago.');
      if (cells.TARIFA.destino && amount !== null && cells.TARIFA.destino.precio !== amount)
        warnings.push(
          'El precio actual de la tarifa difiere de P.AÑO. Se conserva el importe histórico.',
        );
      return {
        id: row.id,
        hoja: row.hojaOrigen,
        fila: row.filaOrigen,
        excluida: excluded,
        identidad: identity,
        suscripcion: excluded
          ? 'EXCLUIDO'
          : !subscriptionReady
            ? 'PENDIENTE'
            : cells.SERVIDOR.estado === 'HISTORICA'
              ? 'HISTORICA'
              : 'RESUELTA',
        finanzas: excluded ? 'EXCLUIDO' : finance,
        fechaFin: data.fecha ?? null,
        fechaInicioPropuesta: start,
        importeAnual: amount,
        totalAcumulado: data.total ?? null,
        referenciaPropia:
          group && ['NUEVO', 'VINCULADO'].includes(identity)
            ? {
                clave: group.clienteDestinoId ?? group.id,
                nombre: identityData(group.datos).nombre,
              }
            : null,
        advertencias: warnings,
        campos: cells,
      };
    };
    const reviewedRows = rows.map(reviewRow);
    const fingerprint = identityHash([
      parent.versionEquivalencias,
      parent.versionIdentidades,
      rows.map((r) => [r.id, r.version, r.identidadId]),
      catalogs,
      [...identities.statuses],
      identities.clients,
    ]);
    const simulate = (dto: DecidirEquivalenciaDto, ids: string[], target?: Catalog) => {
      const selected = new Set(ids);
      const before = new Map(reviewedRows.filter((r) => selected.has(r.id)).map((r) => [r.id, r]));
      const proposed: Decision = {
        id: dto.solicitudId,
        importacionId: id,
        version: parent.versionEquivalencias + 1,
        tipo: dto.tipo,
        alcance: dto.alcance,
        clave: dto.clave,
        filaId: dto.filaId ?? null,
        accion: dto.accion,
        entidadId: dto.entidadId ?? null,
        historico: dto.historico ?? false,
        huellaDestino: target?.huella ?? null,
        origen: {},
        dependencias: Object.fromEntries(
          [...before.values()].map((r) => [r.id, r.campos[dto.tipo].dependencia]),
        ),
        autor: '',
        motivo: dto.motivo,
        solicitudId: dto.solicitudId,
        solicitudHash: '',
        createdAt: new Date(),
      };
      // Simula con el mismo resolutor que la lectura. No escribe ni altera el contexto guardado.
      const key = `${dto.tipo}:${dto.alcance}:${dto.filaId ?? dto.clave}`;
      const previous = latest.get(key);
      latest.set(key, proposed);
      try {
        return rows
          .filter((r) => selected.has(r.id))
          .map((row) => {
            const old = before.get(row.id)!.campos[dto.tipo];
            const next = reviewRow(row).campos[dto.tipo];
            return {
              id: row.id,
              hoja: row.hojaOrigen,
              fila: row.filaOrigen,
              antes: { estado: old.estado, destino: old.destino },
              despues: { estado: next.estado, destino: next.destino },
            };
          });
      } finally {
        if (previous) latest.set(key, previous);
        else latest.delete(key);
      }
    };
    return {
      parent,
      catalogs,
      decisions,
      rows: reviewedRows,
      huellaRevision: fingerprint,
      simulate,
      lecturas: rows,
      identidades: identities,
    };
  }

  async list(id: string, query: EquivalenciasQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const ctx = await this.context(tx, id);
        const type = query.tipo ?? 'PRODUCTO';
        const all = ctx.rows.filter(
          (r) =>
            (!query.hoja || r.hoja === query.hoja) &&
            (!query.estado || (r.excluida ? 'EXCLUIDO' : r.campos[type].estado) === query.estado),
        );
        const inventory = new Map<
          string,
          {
            clave: string;
            etiqueta: string;
            total: number;
            elegibles: number;
            estados: Record<string, number>;
          }
        >();
        for (const row of all) {
          const cell = row.campos[type];
          const g = inventory.get(cell.clave) ?? {
            clave: cell.clave,
            etiqueta: cell.etiqueta,
            total: 0,
            elegibles: 0,
            estados: {},
          };
          g.total++;
          if (!row.excluida) g.elegibles++;
          const status = row.excluida ? 'EXCLUIDO' : cell.estado;
          g.estados[status] = (g.estados[status] ?? 0) + 1;
          inventory.set(cell.clave, g);
        }
        const filtered = all.filter((r) => !query.clave || r.campos[type].clave === query.clave);
        const page = query.page ?? 1,
          limit = query.limit ?? 25;
        const pageRows = filtered.slice((page - 1) * limit, page * limit);
        const visibleIds = new Set(pageRows.map((r) => r.id));
        const visibleKeys = new Set(pageRows.map((r) => r.campos[type].clave));
        const authors = new Map(
          (
            await tx.usuario.findMany({
              where: { id: { in: [...new Set(ctx.decisions.map((d) => d.autor))] } },
              select: { id: true, nombre: true },
            })
          ).map((author) => [author.id, author.nombre]),
        );
        return {
          version: ctx.parent.versionEquivalencias,
          huellaRevision: ctx.huellaRevision,
          hojas: [...new Set(ctx.rows.map((r) => r.hoja))],
          catalogos: ctx.catalogs,
          inventario: [...inventory.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
          resumen: {
            filas: ctx.rows.length,
            excluidas: ctx.rows.filter((r) => r.excluida).length,
            identidadesResueltas: ctx.rows.filter((r) =>
              ['NUEVO', 'VINCULADO'].includes(r.identidad),
            ).length,
            suscripcionesResueltas: ctx.rows.filter((r) => r.suscripcion === 'RESUELTA').length,
            historicas: ctx.rows.filter((r) => r.suscripcion === 'HISTORICA').length,
            pendientesPago: ctx.rows.filter((r) => !r.excluida && r.finanzas === 'PENDIENTE_PAGO')
              .length,
          },
          data: pageRows,
          historial: ctx.decisions
            .filter(
              (d) =>
                d.tipo === type &&
                (d.filaId
                  ? visibleIds.has(d.filaId)
                  : visibleKeys.has(d.clave) ||
                    Object.keys(record(d.dependencias)).some((rowId) => visibleIds.has(rowId))),
            )
            .map((d) => ({
              id: d.id,
              version: d.version,
              tipo: d.tipo,
              alcance: d.alcance,
              filaId: d.filaId,
              clave: d.clave,
              accion: d.accion,
              destino: d.origen,
              historico: d.historico,
              autor: authors.get(d.autor) ?? 'Usuario no disponible',
              autorId: d.autor,
              motivo: d.motivo,
              fecha: d.createdAt,
            })),
          pagination: {
            page,
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / limit),
          },
        };
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private validate(
    ctx: Awaited<ReturnType<EquivalenciasRevisionService['context']>>,
    dto: DecidirEquivalenciaDto,
  ) {
    if (ctx.huellaRevision !== dto.huellaRevision)
      throw new ConflictException('La revisión ha cambiado. Actualiza y vuelve a previsualizar.');
    if ((dto.alcance === 'FILA') !== Boolean(dto.filaId))
      throw new BadRequestException('El alcance por fila requiere únicamente su fila de origen.');
    if ((dto.accion === 'ASIGNAR') !== Boolean(dto.entidadId))
      throw new BadRequestException('Selecciona un destino únicamente al asignar.');
    if (dto.historico && (dto.tipo !== 'SERVIDOR' || dto.accion !== 'ASIGNAR'))
      throw new BadRequestException('El uso histórico solo corresponde a servidores.');
    const affected = ctx.rows.filter(
      (r) =>
        !r.excluida &&
        (dto.alcance === 'FILA' ? r.id === dto.filaId : r.campos[dto.tipo].clave === dto.clave),
    );
    if (!affected.length || affected.some((r) => r.campos[dto.tipo].clave !== dto.clave))
      throw new BadRequestException('No hay filas elegibles con ese origen en este análisis.');
    if (affected.some((r) => r.campos[dto.tipo].ignorado))
      throw new BadRequestException('PA se ignora y no admite equivalencias.');
    const mappingKeys = {
      PRODUCTO: 'productoId',
      TARIFA: 'tarifaId',
      SERVIDOR: 'servidorId',
      REFERENCIA: 'referenciaId',
      PAGO: 'metodoPagoId',
    };
    for (const row of affected) {
      if (dto.alcance === 'VALOR' && row.campos[dto.tipo].alcance === 'FILA') continue;
      const source = ctx.lecturas.find((r) => r.id === row.id)!;
      const locked = dto.tipo === 'PAGO' ? source.renovacionId : source.suscripcionId;
      if (
        locked &&
        (dto.accion !== 'ASIGNAR' || dto.entidadId !== record(source.mapeo)[mappingKeys[dto.tipo]])
      )
        throw new ConflictException(
          'La equivalencia afecta a datos ya importados. Revisa únicamente las filas pendientes.',
        );
    }
    const target = ctx.catalogs[dto.tipo].find((c) => c.id === dto.entidadId);
    if (dto.accion === 'ASIGNAR') {
      if (!target) throw new BadRequestException('El destino no está disponible en el catálogo.');
      if (!target.activo && !dto.historico)
        throw new BadRequestException(
          'Confirma el uso exclusivamente histórico del servidor inactivo.',
        );
      if (target.activo && dto.historico)
        throw new BadRequestException('El destino es un servidor activo.');
      if (dto.alcance === 'VALOR' && affected.some((r) => r.campos[dto.tipo].ausente))
        throw new BadRequestException(
          'Un dato ausente requiere revisión individual; no admite un valor predeterminado masivo.',
        );
      if (
        dto.tipo === 'TARIFA' &&
        affected.some(
          (r) =>
            r.campos.PRODUCTO.estado !== 'RESUELTA' ||
            r.campos.PRODUCTO.destino?.id !== target.productoId ||
            target.duracionMeses !== 12,
        )
      )
        throw new BadRequestException(
          'La tarifa debe ser anual y pertenecer al producto revisado.',
        );
    }
    const overridden =
      dto.alcance === 'VALOR'
        ? affected.filter(
            (r) =>
              r.campos[dto.tipo].alcance === 'FILA' && r.campos[dto.tipo].estado !== 'IGNORADO',
          ).length
        : 0;
    return { affected, target, overridden };
  }

  async preview(id: string, dto: DecidirEquivalenciaDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const ctx = await this.context(tx, id);
        const { affected, target, overridden } = this.validate(ctx, dto);
        const simulated = ctx.simulate(
          dto,
          affected.map((r) => r.id),
          target,
        );
        return {
          huellaRevision: ctx.huellaRevision,
          total: affected.length,
          cambiosEfectivos: affected.length - overridden,
          excepcionesConservadas: overridden,
          destino:
            dto.accion === 'HEREDAR' && dto.alcance === 'FILA'
              ? simulated[0].despues.destino
              : (target ?? null),
          filas: simulated,
          aviso:
            'El alcance por valor abarca todas las hojas del análisis, independientemente de los filtros. Las excepciones por fila prevalecen. No se crean clientes, suscripciones ni cobros.',
        };
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async decide(id: string, actor: string, dto: DecidirEquivalenciaDto) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
          const hash = identityHash([id, actor, dto]);
          const previous = await tx.importacionEquivalenciaRevision.findUnique({
            where: { solicitudId: dto.solicitudId },
          });
          if (previous) {
            if (previous.solicitudHash !== hash)
              throw new ConflictException('La solicitud ya se utilizó para otra decisión.');
            return { id: previous.id, version: previous.version };
          }
          const ctx = await this.context(tx, id, true);
          const { affected, target } = this.validate(ctx, dto);
          const version = ctx.parent.versionEquivalencias + 1;
          const saved = await tx.importacionEquivalenciaRevision.create({
            data: {
              importacionId: id,
              version,
              tipo: dto.tipo,
              alcance: dto.alcance,
              clave: dto.clave,
              filaId: dto.filaId ?? null,
              accion: dto.accion,
              entidadId: dto.entidadId ?? null,
              historico: dto.historico ?? false,
              huellaDestino: target?.huella ?? null,
              origen: json({
                origen: affected[0].campos[dto.tipo].etiqueta,
                destino: target?.nombre ?? null,
              }),
              dependencias: json(
                Object.fromEntries(affected.map((r) => [r.id, r.campos[dto.tipo].dependencia])),
              ),
              autor: actor,
              motivo: dto.motivo,
              solicitudId: dto.solicitudId,
              solicitudHash: hash,
            },
          });
          await tx.importacion.update({ where: { id }, data: { versionEquivalencias: version } });
          await tx.actividad.create({
            data: {
              usuarioId: actor,
              tabla: 'importaciones',
              registroId: id,
              accion: 'REVISAR_EQUIVALENCIA',
              datosNuevos: {
                decisionId: saved.id,
                motivo: dto.motivo,
                accion: dto.accion,
                entidadId: dto.entidadId ?? null,
                destino: target?.nombre ?? null,
                version,
                tipo: dto.tipo,
                alcance: dto.alcance,
                filas: affected.length,
              },
            },
          });
          return { id: saved.id, version };
        },
        { timeout: 30000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code)
        )
          throw new ConflictException(
            'Otra decisión concurrente ha cambiado la revisión. Actualiza y vuelve a previsualizar.',
          );
        throw error;
      });
  }
}

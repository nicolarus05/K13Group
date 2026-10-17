import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { attribution } from '../estadisticas/attribution';
import { createHash } from 'node:crypto';
import { Prisma, ImportacionFila } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  normalizeComparable,
  normalizeName,
  normalizePhone,
} from '../common/helpers/normalization';
import {
  ExcelParserService,
  NormalizedExcelRow,
  ParsedExcelRow,
  publicAppLabel,
} from './excel-parser.service';
import { ConfirmarImportacionDto } from './dto/confirmar-importacion.dto';
import { EquivalenciaImportacionDto, EQUIVALENCE_TYPES } from './dto/equivalencia-importacion.dto';
import { ImportacionFilasDto } from './dto/importacion-filas.dto';
import { RevisarImportacionFilaDto, ROW_DECISIONS } from './dto/revisar-importacion-fila.dto';
import { CorregirLecturaDto } from './dto/corregir-lectura.dto';
import { Corrections, FIELDS, PARSER_VERSION, RowReading, Scope } from './excel-validation';

const IMPORT_STATUS = {
  REVIEW: 'EN_REVISION',
  PROCESSING: 'EN_PROCESO',
  RECONCILING: 'EN_RECONCILIACION',
  COMPLETED: 'COMPLETADA',
  COMPLETED_WITH_ERRORS: 'COMPLETADA_CON_ERRORES',
  FAILED: 'FALLIDA',
} as const;
const ROW_STATUS = {
  VALIDATED: 'VALIDADA',
  CONFLICT: 'EN_CONFLICTO',
  PENDING: 'PENDIENTE_RECONCILIACION',
  FINANCIAL_PENDING: 'PENDIENTE_FINANCIERA',
  READY: 'LISTA_RECONCILIACION',
  IMPORTED: 'IMPORTADA',
  REJECTED: 'RECHAZADA',
  ERROR: 'ERROR',
} as const;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CATALOG_TYPES = new Set<string>(EQUIVALENCE_TYPES);

type ImportReport = {
  clientesNuevos: number;
  posiblesDuplicados: number;
  filasPendientesReconciliacion: number;
  movimientosCreados: number;
  hojas: Array<{
    hoja: string;
    filas: number;
    errores: number;
    advertencias: number;
    detalleErrores?: string[];
    cabecera?: number | null;
    columnasAusentes?: string[];
    columnasAdicionales?: string[];
    clasificacion?: Record<string, number>;
  }>;
  bloqueos?: Record<Scope, number>;
};
type NormalizedIdentity = Pick<
  NormalizedExcelRow,
  'nombreClave' | 'telefonoNormalizado' | 'servidorClave' | 'app' | 'referenciaClave'
>;
type RowMapping = {
  clienteId?: string;
  productoId?: string;
  tarifaId?: string;
  servidorId?: string;
  referenciaId?: string;
  metodoPagoId?: string;
};
type ReconcileOptions = { confirmarOperaciones: boolean; confirmarFinanzas: boolean };

@Injectable()
export class ImportacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelParser: ExcelParserService,
  ) {}

  async preview(file: Express.Multer.File, usuarioId: string) {
    this.validateFile(file);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.importacion.findUnique({
      where: { checksum_versionMapeo: { checksum, versionMapeo: PARSER_VERSION } },
    });
    if (existing) return this.getImportacion(existing.id);
    let parsedSheets;
    try {
      parsedSheets = await this.excelParser.parseAsync(file.buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo leer el Excel.',
      );
    }
    const parsedRows = parsedSheets.flatMap((sheet) => sheet.filas);

    const existingClients = await this.prisma.cliente.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, telefono: true, telefonoNormalizado: true },
    });
    const existingPhones = new Set(
      existingClients
        .map((client) => normalizePhone(client.telefonoNormalizado ?? client.telefono))
        .filter(Boolean),
    );
    const existingNames = new Set(existingClients.map((client) => normalizeName(client.nombre)));
    const identityKeys = new Set<string>();
    const identityCounts = new Map<string, number>();
    for (const row of parsedRows) {
      if (!row.datosNormalizados.nombreClave && !row.datosNormalizados.telefonoNormalizado)
        continue;
      const key = this.identityKey(row.datosNormalizados);
      identityKeys.add(key);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
    const clientesNuevos = [...identityKeys].filter((key) => {
      const [type, value] = key.split(':', 2);
      return type === 'phone' ? !existingPhones.has(value) : !existingNames.has(value);
    }).length;
    const posiblesDuplicados = parsedRows.filter(
      (row) => (identityCounts.get(this.identityKey(row.datosNormalizados)) ?? 0) > 1,
    ).length;
    const errores =
      parsedSheets.reduce((count, sheet) => count + sheet.errores.length, 0) +
      parsedRows.reduce((n, row) => n + row.errores.length, 0);
    const advertencias = parsedRows.reduce((count, row) => count + row.advertencias.length, 0);
    const report: ImportReport = {
      clientesNuevos,
      posiblesDuplicados,
      filasPendientesReconciliacion: parsedRows.length,
      movimientosCreados: 0,
      bloqueos: this.countScopes(parsedRows.map((row) => row.lectura)),
      hojas: parsedSheets.map((sheet) => ({
        hoja: sheet.hoja,
        filas: sheet.filas.length,
        errores: sheet.errores.length + sheet.filas.reduce((n, row) => n + row.errores.length, 0),
        detalleErrores: sheet.errores,
        cabecera: sheet.cabecera,
        columnasAusentes: sheet.columnasAusentes,
        columnasAdicionales: sheet.columnasAdicionales,
        clasificacion: sheet.clasificacion,
        advertencias: sheet.filas.reduce((count, row) => count + row.advertencias.length, 0),
      })),
    };
    const importacion = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${checksum + PARSER_VERSION}))`;
        const accepted = await tx.importacion.findUnique({
          where: { checksum_versionMapeo: { checksum, versionMapeo: PARSER_VERSION } },
        });
        if (accepted) return accepted;
        const created = await tx.importacion.create({
          data: {
            archivo: file.originalname.slice(0, 255),
            usuarioId,
            checksum,
            versionMapeo: PARSER_VERSION,
            estado: IMPORT_STATUS.REVIEW,
            fechaInicio: new Date(),
            registros: parsedRows.length,
            errores,
            advertencias,
            informe: report as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.importacionFila.createMany({
          data: parsedRows.map((row) => ({
            importacionId: created.id,
            hojaOrigen: row.hojaOrigen,
            filaOrigen: row.filaOrigen,
            hashFila: row.hashFila,
            datosOriginales: row.datosOriginales as Prisma.InputJsonValue,
            lectura: row.lectura as unknown as Prisma.InputJsonValue,
            datosNormalizados: row.datosNormalizados as unknown as Prisma.InputJsonValue,
            estado: row.errores.length ? ROW_STATUS.ERROR : ROW_STATUS.VALIDATED,
            errores: row.errores as unknown as Prisma.InputJsonValue,
            advertencias: row.advertencias as unknown as Prisma.InputJsonValue,
          })),
        });
        await tx.actividad.create({
          data: {
            usuarioId,
            tabla: 'importaciones',
            registroId: created.id,
            accion: 'ANALIZAR',
            datosNuevos: { checksum, version: PARSER_VERSION, filas: parsedRows.length },
          },
        });
        return created;
      },
      { timeout: 30000 },
    );
    return this.getImportacion(importacion.id);
  }

  async listImportaciones(page = 1, limit = 25) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1)
      throw new BadRequestException('La página y el límite deben ser enteros positivos.');
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const [items, total] = await Promise.all([
      this.prisma.importacion.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.importacion.count(),
    ]);
    return {
      data: items.map((item) => this.toSummary(item, this.readReport(item.informe))),
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  private countScopes(readings: RowReading[]) {
    const result: Record<Scope, number> = { CLIENTE: 0, SUSCRIPCION: 0, FINANZAS: 0, AVISO: 0 };
    for (const reading of readings) for (const issue of reading.incidencias) result[issue.ambito]++;
    return result;
  }

  async correctReading(id: string, rowId: string, actor: string, dto: CorregirLecturaDto) {
    const entries = Object.entries(dto.cambios);
    if (
      !entries.length ||
      entries.some(
        ([key, value]) =>
          !(FIELDS as readonly string[]).includes(key) ||
          (value !== null && (typeof value !== 'string' || value.length > 10000)),
      )
    )
      throw new BadRequestException(
        'Indica campos de lectura permitidos y valores de hasta 10.000 caracteres.',
      );
    await this.prisma.$transaction(
      async (tx) => {
        // Comparte el bloqueo con otras correcciones del mismo informe y su confirmación.
        await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
        const parent = await tx.importacion.findUnique({ where: { id } });
        if (!parent) throw new NotFoundException('Análisis no encontrado.');
        if (parent.estado !== IMPORT_STATUS.REVIEW || parent.versionMapeo !== PARSER_VERSION)
          throw new ConflictException(
            'Solo se puede corregir una lectura actual todavía en revisión.',
          );
        const row = await tx.importacionFila.findFirst({ where: { id: rowId, importacionId: id } });
        if (!row?.lectura) throw new NotFoundException('Fila de lectura no encontrada.');
        if (row.version !== dto.version)
          throw new ConflictException(
            'La fila ha cambiado. Recarga antes de guardar; tu borrador se conserva.',
          );
        const corrections: Corrections = {
          ...((row.correcciones as Corrections) ?? {}),
          ...dto.cambios,
        };
        const validated = this.excelParser.validateRow(
          row.lectura as unknown as RowReading,
          corrections,
        );
        const history = Array.isArray(row.historialLectura) ? row.historialLectura : [];
        const author = await tx.usuario.findUniqueOrThrow({
          where: { id: actor },
          select: { nombre: true },
        });
        const previousValues = Object.fromEntries(
          entries.map(([key]) => [
            key,
            Object.prototype.hasOwnProperty.call(row.correcciones ?? {}, key)
              ? (row.correcciones as Record<string, Prisma.JsonValue>)[key]
              : (row.lectura as unknown as RowReading).campos[key as keyof RowReading['campos']]
                  .valor,
          ]),
        );
        await tx.importacionFila.update({
          where: { id: rowId },
          data: {
            version: { increment: 1 },
            correcciones: corrections as Prisma.InputJsonValue,
            historialLectura: [
              ...history,
              {
                version: row.version + 1,
                autor: author.nombre,
                usuarioId: actor,
                fecha: new Date().toISOString(),
                motivo: dto.motivo,
                anteriores: previousValues,
                cambios: dto.cambios,
              },
            ] as Prisma.InputJsonValue,
            lectura: validated.lectura as unknown as Prisma.InputJsonValue,
            datosNormalizados: validated.datosNormalizados as unknown as Prisma.InputJsonValue,
            errores: validated.errores,
            advertencias: validated.advertencias,
            estado: validated.errores.length ? ROW_STATUS.ERROR : ROW_STATUS.VALIDATED,
            decision: null,
            mapeo: Prisma.DbNull,
            revisadaPorId: actor,
            revisadaAt: new Date(),
            observacionRevision: dto.motivo,
          },
        });
        const rows = await tx.importacionFila.findMany({
          where: { importacionId: id },
          select: {
            hojaOrigen: true,
            errores: true,
            advertencias: true,
            lectura: true,
            datosNormalizados: true,
          },
        });
        const report = this.readReport(parent.informe);
        report.hojas = report.hojas.map((sheet) => {
          const matching = rows.filter((r) => r.hojaOrigen === sheet.hoja);
          return {
            ...sheet,
            errores:
              (sheet.detalleErrores?.length ?? 0) +
              matching.reduce((n, r) => n + this.jsonStringArray(r.errores).length, 0),
            advertencias: matching.reduce(
              (n, r) => n + this.jsonStringArray(r.advertencias).length,
              0,
            ),
          };
        });
        report.bloqueos = this.countScopes(rows.map((r) => r.lectura as unknown as RowReading));
        const counts = new Map<string, number>();
        for (const row of rows) {
          const identity = row.datosNormalizados as unknown as NormalizedExcelRow;
          if (!identity.nombreClave && !identity.telefonoNormalizado) continue;
          const key = this.identityKey(row.datosNormalizados as unknown as NormalizedExcelRow);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        report.posiblesDuplicados = [...counts.values()]
          .filter((n) => n > 1)
          .reduce((n, count) => n + count, 0);
        const clients = await tx.cliente.findMany({
          where: { deletedAt: null },
          select: { nombre: true, telefonoNormalizado: true, telefono: true },
        });
        const phones = new Set(
          clients.map((c) => normalizePhone(c.telefonoNormalizado ?? c.telefono)).filter(Boolean),
        );
        const names = new Set(clients.map((c) => normalizeName(c.nombre)));
        report.clientesNuevos = [...counts.keys()].filter((key) => {
          const [type, v] = key.split(':', 2);
          return Boolean(v) && !(type === 'phone' ? phones.has(v) : names.has(v));
        }).length;
        await tx.importacion.update({
          where: { id },
          data: {
            errores: report.hojas.reduce((n, s) => n + s.errores, 0),
            advertencias: report.hojas.reduce((n, s) => n + s.advertencias, 0),
            informe: report as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.actividad.create({
          data: {
            usuarioId: actor,
            tabla: 'importacion_filas',
            registroId: rowId,
            accion: 'CORREGIR_LECTURA',
            datosNuevos: {
              importacionId: id,
              campos: entries.map(([key]) => key),
              motivo: dto.motivo,
              version: row.version + 1,
            },
          },
        });
      },
      { timeout: 30000 },
    );
    return this.getImportacion(id);
  }

  async confirm(
    id: string,
    usuarioId: string,
    idempotencyKey: string | undefined,
    dto: ConfirmarImportacionDto,
  ) {
    if (!dto.confirmar) throw new BadRequestException('La confirmación explícita es obligatoria.');
    if (!idempotencyKey?.trim())
      throw new BadRequestException('Falta la cabecera Idempotency-Key.');
    const current = await this.prisma.importacion.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Importación ${id} no encontrada.`);
    if (current.versionMapeo === PARSER_VERSION)
      throw new ConflictException(
        'Este análisis corresponde a lectura y validación (12.1). La creación de clientes se habilitará al completar la revisión de identidades.',
      );
    if (
      [IMPORT_STATUS.COMPLETED, IMPORT_STATUS.COMPLETED_WITH_ERRORS].includes(
        current.estado as never,
      )
    )
      return this.getImportacion(id);
    if (current.estado !== IMPORT_STATUS.REVIEW)
      throw new ConflictException(`La importación está en estado ${current.estado}.`);
    if (current.errores > 0)
      throw new BadRequestException('La importación contiene errores bloqueantes.');
    if (current.advertencias > 0 && !dto.permitirAdvertencias)
      throw new BadRequestException('Debes aceptar las advertencias antes de confirmar.');

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.importacion.updateMany({
        where: { id, estado: IMPORT_STATUS.REVIEW },
        data: { estado: IMPORT_STATUS.PROCESSING },
      });
      const importacion = await tx.importacion.findUnique({
        where: { id },
        include: { filas: { orderBy: [{ hojaOrigen: 'asc' }, { filaOrigen: 'asc' }] } },
      });
      if (!importacion) throw new NotFoundException(`Importación ${id} no encontrada.`);
      if (!claimed.count) return importacion;
      const estadoActivo = await tx.estado.findFirstOrThrow({
        where: { tipo: 'cliente', valor: 'ACTIVO' },
      });
      const clients = await tx.cliente.findMany({
        where: { deletedAt: null },
        select: { id: true, nombre: true, telefono: true, telefonoNormalizado: true },
      });
      const byPhone = new Map<string, string | null>();
      const byName = new Map<string, string | null>();
      for (const client of clients) {
        const phone = normalizePhone(client.telefonoNormalizado ?? client.telefono);
        if (phone) byPhone.set(phone, byPhone.has(phone) ? null : client.id);
        const name = normalizeName(client.nombre);
        if (name) byName.set(name, byName.has(name) ? null : client.id);
      }
      let createdClients = 0;
      let omittedRows = 0;
      let pendingReviewRows = 0;
      for (const row of importacion.filas) {
        if (row.estado === ROW_STATUS.IMPORTED) continue;
        if (row.estado === ROW_STATUS.ERROR) {
          omittedRows += 1;
          continue;
        }
        const normalized = row.datosNormalizados as unknown as NormalizedExcelRow;
        const phone = normalizePhone(normalized.telefonoNormalizado ?? normalized.telefono);
        const name = normalizeName(normalized.nombre);
        let clienteId = phone ? (byPhone.get(phone) ?? undefined) : undefined;
        if (!clienteId && phone && byPhone.has(phone)) {
          await this.setConflict(tx, row, 'Teléfono asociado a más de un cliente.');
          omittedRows += 1;
          pendingReviewRows += 1;
          continue;
        }
        if (!clienteId && name) clienteId = byName.get(name) ?? undefined;
        if (!clienteId && name && byName.has(name)) {
          await this.setConflict(tx, row, 'Nombre asociado a más de un cliente.');
          omittedRows += 1;
          pendingReviewRows += 1;
          continue;
        }
        if (!clienteId && name) {
          const created = await tx.cliente.create({
            data: {
              nombre: normalized.nombre.slice(0, 150),
              telefono: normalized.telefono?.slice(0, 30) ?? null,
              telefonoNormalizado: phone,
              estadoId: estadoActivo.id,
            },
          });
          clienteId = created.id;
          byName.set(name, created.id);
          if (phone) byPhone.set(phone, created.id);
          createdClients += 1;
        }
        if (clienteId && normalized.nombre) {
          await tx.referencia.upsert({
            where: { nombre: normalized.nombre.slice(0, 100) },
            update: { activo: true, deletedAt: null },
            create: { nombre: normalized.nombre.slice(0, 100), activo: true },
          });
        }
        const warnings = this.jsonStringArray(row.advertencias);
        if (!phone)
          warnings.push('Cliente creado o vinculado sin teléfono normalizado; revisar identidad.');
        await tx.importacionFila.update({
          where: { id: row.id },
          data: {
            clienteId: clienteId ?? null,
            estado: clienteId ? ROW_STATUS.PENDING : ROW_STATUS.ERROR,
            decision: clienteId ? null : 'RECHAZAR',
            advertencias: [...new Set(warnings)] as unknown as Prisma.InputJsonValue,
          },
        });
        if (!clienteId) omittedRows += 1;
        else pendingReviewRows += 1;
      }
      const report = this.readReport(importacion.informe);
      const finalReport = {
        ...report,
        clientesNuevos: createdClients,
        filasPendientesReconciliacion: pendingReviewRows,
        movimientosCreados: 0,
      };
      // Las filas pendientes de revisión no son errores de importación. La
      // importación queda completada y el contador de pendientes informa del
      // trabajo de reconciliación que aún queda por hacer.
      const finalStatus =
        omittedRows > 0 ? IMPORT_STATUS.COMPLETED_WITH_ERRORS : IMPORT_STATUS.COMPLETED;
      const updated = await tx.importacion.update({
        where: { id },
        data: {
          estado: finalStatus,
          fechaFin: new Date(),
          errores: omittedRows,
          informe: finalReport as unknown as Prisma.InputJsonValue,
        },
        include: { filas: true },
      });
      await tx.actividad.create({
        data: {
          usuarioId,
          tabla: 'importaciones',
          registroId: id,
          accion: 'CONFIRMAR',
          datosNuevos: {
            idempotencyKey,
            estado: finalStatus,
            clientesCreados: createdClients,
            filasPendientesReconciliacion: pendingReviewRows,
          },
        },
      });
      return updated;
    });
    return this.toSummary(result, this.readReport(result.informe));
  }

  async getImportacion(id: string) {
    const importacion = await this.prisma.importacion.findUnique({
      where: { id },
      include: { _count: { select: { filas: true } } },
    });
    if (!importacion) throw new NotFoundException(`Importación ${id} no encontrada.`);
    const report = this.readReport(importacion.informe);
    const pending = await this.prisma.importacionFila.count({
      where: { importacionId: id, estado: { notIn: [ROW_STATUS.IMPORTED, ROW_STATUS.REJECTED] } },
    });
    return this.toSummary(importacion, { ...report, filasPendientesReconciliacion: pending });
  }

  async getFilas(id: string, query: ImportacionFilasDto, onlyErrors = false) {
    await this.ensureImportacion(id);
    const where: Prisma.ImportacionFilaWhereInput = {
      importacionId: id,
      ...(onlyErrors ? { estado: { in: [ROW_STATUS.ERROR, ROW_STATUS.CONFLICT] } } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.hoja ? { hojaOrigen: query.hoja } : {}),
      ...(query.ambito
        ? { lectura: { path: ['incidencias'], array_contains: [{ ambito: query.ambito }] } }
        : {}),
      ...(query.buscar
        ? {
            OR: [
              { hojaOrigen: { contains: query.buscar, mode: 'insensitive' } },
              {
                datosNormalizados: {
                  path: ['nombre'],
                  string_contains: query.buscar,
                  mode: 'insensitive',
                },
              },
              { datosNormalizados: { path: ['telefono'], string_contains: query.buscar } },
              { cliente: { nombre: { contains: query.buscar, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.importacionFila.findMany({
        where,
        orderBy: [{ hojaOrigen: 'asc' }, { filaOrigen: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.importacionFila.count({ where }),
    ]);
    return {
      success: true,
      data: rows.map((row) => this.publicRow(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getCatalogos(id: string) {
    await this.ensureImportacion(id);
    const [productos, tarifas, servidores, referencias, metodosPago, equivalencias] =
      await Promise.all([
        this.prisma.producto.findMany({
          where: { activo: true, deletedAt: null },
          orderBy: { nombre: 'asc' },
        }),
        this.prisma.tarifa.findMany({
          where: { activo: true, producto: { activo: true, deletedAt: null } },
          include: { producto: true },
          orderBy: { nombre: 'asc' },
        }),
        this.prisma.servidor.findMany({
          where: { activo: true, deletedAt: null },
          orderBy: { nombre: 'asc' },
        }),
        this.prisma.referencia.findMany({
          where: { activo: true, deletedAt: null },
          orderBy: { nombre: 'asc' },
        }),
        this.prisma.metodoPago.findMany({
          where: { activo: true, deletedAt: null },
          orderBy: { nombre: 'asc' },
        }),
        this.prisma.importacionEquivalencia.findMany({
          where: { activo: true },
          orderBy: [{ tipo: 'asc' }, { valorClave: 'asc' }],
        }),
      ]);
    return { productos, tarifas, servidores, referencias, metodosPago, equivalencias };
  }

  async getPendingValues(id: string) {
    await this.ensureImportacion(id);
    const [rows, equivalencias] = await Promise.all([
      this.prisma.importacionFila.findMany({
        where: { importacionId: id, estado: { notIn: [ROW_STATUS.IMPORTED, ROW_STATUS.REJECTED] } },
        select: { datosNormalizados: true, mapeo: true },
      }),
      this.prisma.importacionEquivalencia.findMany({
        where: { activo: true },
        select: { tipo: true, valorClave: true, entidadId: true },
      }),
    ]);
    const equivalenceKeys = new Set(
      equivalencias
        .filter((item) => item.entidadId)
        .map((item) => `${item.tipo}:${item.valorClave}`),
    );
    const counters = new Map<
      string,
      { tipo: string; valorOrigen: string; valorClave: string; filas: number }
    >();
    for (const row of rows) {
      const normalized = row.datosNormalizados as unknown as NormalizedExcelRow;
      const mapping = this.readMapping(row.mapeo);
      const values = [
        {
          tipo: 'PRODUCTO',
          origen: normalized.app,
          clave: normalized.productoClave,
          resolved:
            Boolean(mapping.productoId) ||
            equivalenceKeys.has(`PRODUCTO:${normalized.productoClave}`),
        },
        {
          tipo: 'SERVIDOR',
          origen: normalized.servidor,
          clave: normalized.servidorClave,
          resolved:
            Boolean(mapping.servidorId) ||
            equivalenceKeys.has(`SERVIDOR:${normalized.servidorClave}`),
        },
        {
          tipo: 'REFERENCIA',
          origen: normalized.referencia,
          clave: normalized.referenciaClave,
          resolved:
            Boolean(mapping.referenciaId) ||
            equivalenceKeys.has(`REFERENCIA:${normalized.referenciaClave}`),
        },
        {
          tipo: 'PAGO',
          origen: normalized.pago,
          clave: normalized.pagoClave,
          resolved:
            Boolean(mapping.metodoPagoId) || equivalenceKeys.has(`PAGO:${normalized.pagoClave}`),
        },
        {
          tipo: 'TARIFA',
          origen: this.tariffSource(normalized),
          clave: this.tariffKey(normalized),
          resolved:
            Boolean(mapping.tarifaId) ||
            equivalenceKeys.has(`TARIFA:${this.tariffKey(normalized)}`),
        },
      ];
      for (const item of values) {
        if (!item.clave || item.resolved) continue;
        const key = `${item.tipo}:${item.clave}`;
        const found = counters.get(key);
        if (found) found.filas += 1;
        else
          counters.set(key, {
            tipo: item.tipo,
            valorOrigen: item.origen ?? item.clave,
            valorClave: item.clave,
            filas: 1,
          });
      }
    }
    return [...counters.values()].sort((a, b) => b.filas - a.filas || a.tipo.localeCompare(b.tipo));
  }

  async saveEquivalence(id: string, usuarioId: string, dto: EquivalenciaImportacionDto) {
    await this.ensureImportacion(id);
    if (!CATALOG_TYPES.has(dto.tipo))
      throw new BadRequestException('Tipo de equivalencia no permitido.');
    if (!dto.entidadId)
      throw new BadRequestException('La equivalencia debe apuntar a un registro de catálogo.');
    await this.validateCatalogEntity(dto.tipo, dto.entidadId);
    const valorClave =
      dto.tipo === 'TARIFA'
        ? dto.valorClave.trim().toUpperCase()
        : normalizeComparable(dto.valorClave);
    const result = await this.prisma.importacionEquivalencia.upsert({
      where: { tipo_valorClave: { tipo: dto.tipo, valorClave } },
      update: {
        valorOrigen: dto.valorOrigen.trim(),
        valorCanonico: dto.valorCanonico.trim(),
        entidadId: dto.entidadId,
        activo: true,
      },
      create: {
        tipo: dto.tipo,
        valorOrigen: dto.valorOrigen.trim(),
        valorClave,
        valorCanonico: dto.valorCanonico.trim(),
        entidadId: dto.entidadId,
      },
    });
    await this.prisma.actividad.create({
      data: {
        usuarioId,
        tabla: 'importacion_equivalencias',
        registroId: result.id,
        accion: 'UPSERT',
        datosNuevos: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async reviewRow(
    importacionId: string,
    filaId: string,
    usuarioId: string,
    dto: RevisarImportacionFilaDto,
  ) {
    const analysis = await this.prisma.importacion.findUnique({ where: { id: importacionId } });
    if (analysis?.versionMapeo === PARSER_VERSION)
      throw new ConflictException('Completa primero la lectura y la revisión de identidades.');
    const row = await this.prisma.importacionFila.findFirst({
      where: { id: filaId, importacionId },
    });
    if (!row) throw new NotFoundException(`Fila ${filaId} no encontrada en la importación.`);
    if (![...ROW_DECISIONS].includes(dto.decision))
      throw new BadRequestException('Decisión no válida.');
    if (row.estado === ROW_STATUS.IMPORTED)
      throw new ConflictException('La fila ya fue reconciliada y es inmutable.');
    const mapping: RowMapping = {
      ...this.readMapping(row.mapeo),
      ...(dto.clienteId ? { clienteId: dto.clienteId } : {}),
      ...(dto.productoId ? { productoId: dto.productoId } : {}),
      ...(dto.tarifaId ? { tarifaId: dto.tarifaId } : {}),
      ...(dto.servidorId ? { servidorId: dto.servidorId } : {}),
      ...(dto.referenciaId ? { referenciaId: dto.referenciaId } : {}),
      ...(dto.metodoPagoId ? { metodoPagoId: dto.metodoPagoId } : {}),
    };
    if (dto.decision === 'ACEPTAR') {
      if (!mapping.clienteId)
        throw new BadRequestException('Debes seleccionar un cliente para aceptar la fila.');
      await this.validateMapping(mapping);
      await this.validateTariffProduct(mapping);
    }
    const estado =
      dto.decision === 'RECHAZAR'
        ? ROW_STATUS.REJECTED
        : dto.decision === 'ACEPTAR'
          ? ROW_STATUS.READY
          : ROW_STATUS.PENDING;
    const updated = await this.prisma.importacionFila.update({
      where: { id: filaId },
      data: {
        decision: dto.decision,
        estado,
        clienteId: mapping.clienteId ?? null,
        mapeo: mapping as unknown as Prisma.InputJsonValue,
        revisadaPorId: usuarioId,
        revisadaAt: new Date(),
        observacionRevision: dto.observacion?.trim() || null,
      },
    });
    await this.prisma.actividad.create({
      data: {
        usuarioId,
        tabla: 'importacion_filas',
        registroId: filaId,
        accion: 'REVISAR',
        datosNuevos: { decision: dto.decision, mapping, observacion: dto.observacion ?? null },
      },
    });
    return this.publicRow(updated);
  }

  async reconcile(importacionId: string, usuarioId: string, options: ReconcileOptions) {
    const analysis = await this.prisma.importacion.findUnique({ where: { id: importacionId } });
    if (analysis?.versionMapeo === PARSER_VERSION)
      throw new ConflictException('La lectura 12.1 no habilita operaciones ni cobros.');
    if (!options.confirmarOperaciones)
      throw new BadRequestException('Debes confirmar explícitamente la creación de operaciones.');
    const claimed = await this.prisma.importacion.updateMany({
      where: {
        id: importacionId,
        estado: { in: [IMPORT_STATUS.COMPLETED, IMPORT_STATUS.COMPLETED_WITH_ERRORS] },
      },
      data: { estado: IMPORT_STATUS.RECONCILING },
    });
    if (!claimed.count) {
      const current = await this.prisma.importacion.findUnique({ where: { id: importacionId } });
      if (!current) throw new NotFoundException(`Importación ${importacionId} no encontrada.`);
      if (current.estado === IMPORT_STATUS.RECONCILING)
        throw new ConflictException('La importación ya se está reconciliando.');
      throw new ConflictException(`La importación está en estado ${current.estado}.`);
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const importacion = await tx.importacion.findUnique({
          where: { id: importacionId },
          include: {
            filas: {
              where: {
                decision: 'ACEPTAR',
                estado: { notIn: [ROW_STATUS.IMPORTED, ROW_STATUS.REJECTED] },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        if (!importacion)
          throw new NotFoundException(`Importación ${importacionId} no encontrada.`);
        const equivalencias = await tx.importacionEquivalencia.findMany({
          where: { activo: true },
        });
        const eqMap = new Map(
          equivalencias.map((item) => [`${item.tipo}:${item.valorClave}`, item]),
        );
        const estados = await this.loadReconciliationStates(tx);
        let subscriptionsCreated = 0;
        let renewalsCreated = 0;
        let movementsCreated = 0;
        let pending = 0;
        for (const row of importacion.filas) {
          const normalized = row.datosNormalizados as unknown as NormalizedExcelRow;
          const mapping = this.completeMapping(this.readMapping(row.mapeo), normalized, eqMap);
          if (
            normalized.estadoPago === 'PENDIENTE' ||
            normalized.estadoPago === 'DESCONOCIDO' ||
            normalizeComparable(normalized.pago) === 'PA'
          ) {
            pending++;
            await this.markPending(
              tx,
              row,
              'Pago pendiente o no resuelto; no se contabiliza automáticamente.',
            );
            continue;
          }
          if (
            !mapping.clienteId ||
            !mapping.productoId ||
            !mapping.tarifaId ||
            !mapping.servidorId
          ) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'Faltan equivalencias de cliente, producto, tarifa o servidor.',
            );
            continue;
          }
          const tariff = await tx.tarifa.findUnique({
            where: { id: mapping.tarifaId },
            include: { producto: true },
          });
          const product = await tx.producto.findUnique({ where: { id: mapping.productoId } });
          const server = await tx.servidor.findUnique({ where: { id: mapping.servidorId } });
          const reference = mapping.referenciaId
            ? await tx.referencia.findUnique({ where: { id: mapping.referenciaId } })
            : null;
          if (!tariff || !product || !server) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'El producto, tarifa o servidor seleccionado ya no está disponible.',
            );
            continue;
          }
          if (tariff.productoId !== product.id) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'La tarifa seleccionada no pertenece al producto seleccionado.',
            );
            continue;
          }
          if (!normalized.fecha) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'La fecha es obligatoria para crear una suscripción histórica.',
            );
            continue;
          }
          const end = this.utcDate(normalized.fecha);
          const start = this.shiftMonths(end, -12);
          const existingSubscription = await tx.suscripcion.findFirst({
            where: {
              clienteId: mapping.clienteId,
              productoId: mapping.productoId,
              servidorId: mapping.servidorId,
              deletedAt: null,
              ...(normalized.identificadorOperativoHash
                ? { identificadorOperativoHash: normalized.identificadorOperativoHash }
                : {}),
            },
          });
          const subscription =
            existingSubscription ??
            (await tx.suscripcion.create({
              data: {
                clienteId: mapping.clienteId,
                productoId: mapping.productoId,
                tarifaId: mapping.tarifaId,
                servidorId: mapping.servidorId,
                referenciaId: mapping.referenciaId ?? null,
                fechaInicio: start,
                fechaFin: end,
                estadoId: estados.suscripcion,
                tipoDispositivo: normalized.tipoDispositivo,
                identificadorOperativoHash: normalized.identificadorOperativoHash,
                identificadorOperativoCifrado: normalized.app,
              },
            }));
          if (!existingSubscription) subscriptionsCreated += 1;
          const payment = mapping.metodoPagoId
            ? await tx.metodoPago.findUnique({ where: { id: mapping.metodoPagoId } })
            : null;
          if (!payment) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'Método de pago no reconciliado; no se contabiliza la operación.',
            );
            continue;
          }
          const isFree = payment.esGratuito;
          // Los pagos gratuitos sí generan la renovación, aunque no haya
          // confirmación financiera, porque no crean ningún movimiento monetario.
          if (!options.confirmarFinanzas && !isFree) {
            pending += 1;
            await tx.importacionFila.update({
              where: { id: row.id },
              data: {
                clienteId: mapping.clienteId,
                suscripcionId: subscription.id,
                mapeo: mapping as unknown as Prisma.InputJsonValue,
                estado: ROW_STATUS.FINANCIAL_PENDING,
              },
            });
            continue;
          }
          if (!isFree && (!normalized.importeAnual || normalized.importeAnual <= 0)) {
            pending += 1;
            await this.markPending(
              tx,
              row,
              'P.AÑO debe ser mayor que cero para contabilizar el pago anual.',
            );
            continue;
          }
          const amount = isFree ? 0 : normalized.importeAnual!;
          const frozenAttribution = attribution(product.id, server.id, reference?.id ?? null);
          const renewal = await tx.renovacion.create({
            data: {
              ...frozenAttribution,
              suscripcionId: subscription.id,
              tipoOperacion: existingSubscription ? 'RENOVACION' : 'ALTA',
              fechaInicio: start,
              fechaFin: end,
              fechaOperacion: start,
              importe: amount,
              metodoPagoId: payment.id,
              estadoId: estados.renovacion,
              origen: existingSubscription
                ? 'IMPORTACION_EXCEL_RENOVACION'
                : 'IMPORTACION_EXCEL_ALTA',
              productoNombreSnapshot: product.nombre,
              tarifaNombreSnapshot: tariff.nombre,
              servidorNombreSnapshot: server.nombre,
              referenciaNombreSnapshot: reference?.nombre,
              metodoPagoNombreSnapshot: payment.nombre,
              observaciones: normalized.observaciones,
            },
          });
          const movement = isFree
            ? null
            : await tx.movimientoFinanciero.create({
                data: {
                  ...frozenAttribution,
                  tipoId: estados.movimientoIngreso,
                  suscripcionId: subscription.id,
                  renovacionId: renewal.id,
                  importe: amount,
                  fecha: start,
                  estadoId: estados.movimientoConfirmado,
                  origen: 'IMPORTACION_EXCEL',
                  productoNombreSnapshot: product.nombre,
                  tarifaNombreSnapshot: tariff.nombre,
                  servidorNombreSnapshot: server.nombre,
                  referenciaNombreSnapshot: reference?.nombre,
                  metodoPagoNombreSnapshot: payment.nombre,
                  descripcion: normalized.observaciones,
                },
              });
          if (end > subscription.fechaFin) {
            await tx.suscripcion.update({
              where: { id: subscription.id },
              data: {
                fechaInicio: start,
                fechaFin: end,
                tarifaId: tariff.id,
                ...(mapping.referenciaId ? { referenciaId: mapping.referenciaId } : {}),
              },
            });
          }
          await tx.importacionFila.update({
            where: { id: row.id },
            data: {
              clienteId: mapping.clienteId,
              suscripcionId: subscription.id,
              renovacionId: renewal.id,
              movimientoId: movement?.id ?? null,
              mapeo: mapping as unknown as Prisma.InputJsonValue,
              estado: ROW_STATUS.IMPORTED,
            },
          });
          renewalsCreated += 1;
          if (movement) movementsCreated += 1;
        }
        const report = this.readReport(importacion.informe);
        const finalReport = {
          ...report,
          filasPendientesReconciliacion: pending,
          movimientosCreados: report.movimientosCreados + movementsCreated,
          suscripcionesCreadas: subscriptionsCreated,
          renovacionesCreadas: renewalsCreated,
        };
        const updated = await tx.importacion.update({
          where: { id: importacionId },
          data: {
            estado: pending > 0 ? IMPORT_STATUS.COMPLETED_WITH_ERRORS : IMPORT_STATUS.COMPLETED,
            informe: finalReport as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.actividad.create({
          data: {
            usuarioId,
            tabla: 'importaciones',
            registroId: importacionId,
            accion: 'RECONCILIAR',
            datosNuevos: {
              confirmarFinanzas: options.confirmarFinanzas,
              subscriptionsCreated,
              renewalsCreated,
              movementsCreated,
              pending,
            },
          },
        });
        return { updated, report: finalReport };
      });
      return this.toSummary(result.updated, result.report);
    } catch (error) {
      await this.prisma.importacion.update({
        where: { id: importacionId },
        data: { estado: IMPORT_STATUS.COMPLETED_WITH_ERRORS },
      });
      throw error;
    }
  }

  private async setConflict(tx: Prisma.TransactionClient, row: ImportacionFila, warning: string) {
    await tx.importacionFila.update({
      where: { id: row.id },
      data: {
        estado: ROW_STATUS.CONFLICT,
        advertencias: [
          ...new Set([...this.jsonStringArray(row.advertencias), warning]),
        ] as unknown as Prisma.InputJsonValue,
      },
    });
  }
  private async loadReconciliationStates(tx: Prisma.TransactionClient) {
    const find = async (tipo: string, valor: string) => {
      const state = await tx.estado.findFirst({ where: { tipo, valor } });
      if (!state)
        throw new BadRequestException(
          `Falta el estado ${tipo}/${valor}. Ejecuta el seed de la base de datos.`,
        );
      return state.id;
    };
    return {
      suscripcion: await find('suscripcion', 'ACTIVA'),
      renovacion: await find('renovacion', 'COMPLETADA'),
      movimientoIngreso: await find('movimiento_tipo', 'INGRESO'),
      movimientoConfirmado: await find('movimiento_estado', 'CONFIRMADO'),
    };
  }
  private async markPending(tx: Prisma.TransactionClient, row: ImportacionFila, warning: string) {
    await tx.importacionFila.update({
      where: { id: row.id },
      data: {
        estado: ROW_STATUS.PENDING,
        advertencias: [
          ...new Set([...this.jsonStringArray(row.advertencias), warning]),
        ] as unknown as Prisma.InputJsonValue,
      },
    });
  }
  private completeMapping(
    mapping: RowMapping,
    normalized: NormalizedExcelRow,
    eqMap: Map<string, { tipo: string; valorClave: string; entidadId: string | null }>,
  ): RowMapping {
    const result = { ...mapping };
    const find = (tipo: string, clave: string | null) =>
      clave ? (eqMap.get(`${tipo}:${clave}`)?.entidadId ?? undefined) : undefined;
    result.productoId ||= find('PRODUCTO', normalized.productoClave);
    result.servidorId ||= find('SERVIDOR', normalized.servidorClave);
    result.referenciaId ||= find('REFERENCIA', normalized.referenciaClave);
    result.metodoPagoId ||= find('PAGO', normalized.pagoClave);
    result.tarifaId ||= find('TARIFA', this.tariffKey(normalized));
    return result;
  }
  private async validateMapping(mapping: RowMapping) {
    if (
      mapping.clienteId &&
      !(await this.prisma.cliente.findUnique({ where: { id: mapping.clienteId } }))
    )
      throw new BadRequestException('Cliente no encontrado.');
    if (mapping.productoId) await this.validateCatalogEntity('PRODUCTO', mapping.productoId);
    if (mapping.tarifaId) await this.validateCatalogEntity('TARIFA', mapping.tarifaId);
    if (mapping.servidorId) await this.validateCatalogEntity('SERVIDOR', mapping.servidorId);
    if (mapping.referenciaId) await this.validateCatalogEntity('REFERENCIA', mapping.referenciaId);
    if (mapping.metodoPagoId) await this.validateCatalogEntity('PAGO', mapping.metodoPagoId);
  }
  private async validateTariffProduct(mapping: RowMapping) {
    if (!mapping.productoId || !mapping.tarifaId) return;
    const tariff = await this.prisma.tarifa.findUnique({
      where: { id: mapping.tarifaId },
      select: { productoId: true },
    });
    if (tariff && tariff.productoId !== mapping.productoId)
      throw new BadRequestException(
        'La tarifa seleccionada no pertenece al producto seleccionado.',
      );
  }
  private async validateCatalogEntity(tipo: string, id: string) {
    const exists =
      tipo === 'PRODUCTO'
        ? await this.prisma.producto.findFirst({ where: { id, activo: true, deletedAt: null } })
        : tipo === 'TARIFA'
          ? await this.prisma.tarifa.findFirst({ where: { id, activo: true } })
          : tipo === 'SERVIDOR'
            ? await this.prisma.servidor.findFirst({ where: { id, activo: true, deletedAt: null } })
            : tipo === 'REFERENCIA'
              ? await this.prisma.referencia.findFirst({
                  where: { id, activo: true, deletedAt: null },
                })
              : await this.prisma.metodoPago.findFirst({
                  where: { id, activo: true, deletedAt: null },
                });
    if (!exists)
      throw new BadRequestException(
        `El registro de catálogo ${tipo}/${id} no existe o está inactivo.`,
      );
  }
  private readMapping(value: Prisma.JsonValue | null | undefined): RowMapping {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const raw = value as Record<string, Prisma.JsonValue>;
    const result: RowMapping = {};
    for (const key of [
      'clienteId',
      'productoId',
      'tarifaId',
      'servidorId',
      'referenciaId',
      'metodoPagoId',
    ] as const)
      if (typeof raw[key] === 'string') result[key] = raw[key] as string;
    return result;
  }
  private tariffKey(row: NormalizedExcelRow) {
    return `${row.productoClave ?? 'SIN_PRODUCTO'}|${row.importeAnual ?? 'SIN_PAGO_ANUAL'}`.toUpperCase();
  }
  private tariffSource(row: NormalizedExcelRow) {
    return `${row.app ?? 'APP SIN VALOR'} · P.AÑO ${row.importeAnual ?? '—'}`;
  }
  private utcDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`Fecha inválida: ${value}`);
    return date;
  }
  private shiftMonths(date: Date, months: number) {
    const result = new Date(date);
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
  }
  private async ensureImportacion(id: string) {
    const exists = await this.prisma.importacion.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Importación ${id} no encontrada.`);
  }
  private validateFile(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Debes adjuntar un archivo Excel.');
    if (file.buffer.length > MAX_FILE_SIZE)
      throw new BadRequestException('El Excel supera el límite de 10 MB.');
    const filename = file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls'))
      throw new BadRequestException('Solo se admiten archivos .xlsx o .xls.');
  }
  private identityKey(row: NormalizedIdentity): string {
    return row.telefonoNormalizado ? `phone:${row.telefonoNormalizado}` : `name:${row.nombreClave}`;
  }
  private addCumulativeTotalWarnings(rows: ParsedExcelRow[]) {
    const groups = new Map<string, ParsedExcelRow[]>();
    for (const row of rows) {
      const key = this.identityKey(row.datosNormalizados);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const ordered = group
        .filter((row) => row.datosNormalizados.fecha && row.datosNormalizados.total !== null)
        .sort((a, b) => a.datosNormalizados.fecha!.localeCompare(b.datosNormalizados.fecha!));
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1].datosNormalizados.total!;
        const current = ordered[index].datosNormalizados.total!;
        if (current < previous)
          ordered[index].advertencias.push(
            'TOTAL acumulado inferior al de una fecha anterior; revisar el histórico.',
          );
      }
    }
  }
  private jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
  private readReport(value: Prisma.JsonValue | null): ImportReport {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return {
        clientesNuevos: 0,
        posiblesDuplicados: 0,
        filasPendientesReconciliacion: 0,
        movimientosCreados: 0,
        hojas: [],
      };
    const report = value as Record<string, Prisma.JsonValue>;
    return {
      clientesNuevos: Number(report.clientesNuevos ?? 0),
      posiblesDuplicados: Number(report.posiblesDuplicados ?? 0),
      filasPendientesReconciliacion: Number(report.filasPendientesReconciliacion ?? 0),
      movimientosCreados: Number(report.movimientosCreados ?? 0),
      bloqueos: report.bloqueos as ImportReport['bloqueos'],
      hojas: Array.isArray(report.hojas) ? (report.hojas as unknown as ImportReport['hojas']) : [],
    };
  }
  private toSummary(
    importacion: {
      id: string;
      archivo: string;
      checksum: string | null;
      versionMapeo?: string;
      estado: string;
      registros: number;
      errores: number;
      advertencias: number;
      fechaInicio: Date | null;
      fechaFin: Date | null;
    },
    report: ImportReport,
  ) {
    return {
      importacionId: importacion.id,
      archivo: importacion.archivo,
      checksum: importacion.checksum,
      versionMapeo: importacion.versionMapeo,
      soloLectura: importacion.versionMapeo === PARSER_VERSION,
      bloqueos: report.bloqueos,
      estado: importacion.estado,
      filas: importacion.registros,
      clientesNuevos: report.clientesNuevos,
      posiblesDuplicados: report.posiblesDuplicados,
      errores: importacion.errores,
      advertencias: importacion.advertencias,
      filasPendientesReconciliacion: report.filasPendientesReconciliacion,
      movimientosCreados: report.movimientosCreados,
      fechaInicio: importacion.fechaInicio,
      fechaFin: importacion.fechaFin,
      hojas: report.hojas,
    };
  }
  private publicRow(row: ImportacionFila) {
    const normalized = row.datosNormalizados as Record<string, Prisma.JsonValue>;
    const reading = row.lectura ? (JSON.parse(JSON.stringify(row.lectura)) as RowReading) : null;
    if (reading)
      for (const [key, cell] of Object.entries(reading.campos)) {
        if (key === 'APP') cell.valor = cell.valor === null ? null : '[DATO OPERATIVO PROTEGIDO]';
        // Las fórmulas pueden contener identificadores y vínculos privados.
        if (cell.formula) cell.formula = '[FÓRMULA: resultado almacenado]';
      }
    return {
      id: row.id,
      hojaOrigen: row.hojaOrigen,
      filaOrigen: row.filaOrigen,
      hashFila: row.hashFila,
      version: row.version,
      lectura: reading,
      correcciones: row.correcciones ? this.maskSensitiveData(row.correcciones) : {},
      historialLectura: Array.isArray(row.historialLectura)
        ? row.historialLectura.map((value) => {
            const event = value as Record<string, Prisma.JsonValue>;
            return {
              ...event,
              anteriores: this.maskSensitiveData(event.anteriores),
              cambios: this.maskSensitiveData(event.cambios),
            };
          })
        : [],
      estado: row.estado,
      decision: row.decision,
      datosOriginales: this.maskSensitiveData(row.datosOriginales),
      datosNormalizados: {
        ...normalized,
        app: publicAppLabel(normalized.app),
        productoClave: publicAppLabel(normalized.productoClave),
      },
      mapeo: row.mapeo,
      errores: row.errores,
      advertencias: row.advertencias,
      clienteId: row.clienteId,
      suscripcionId: row.suscripcionId,
      renovacionId: row.renovacionId,
      movimientoId: row.movimientoId,
      observacionRevision: row.observacionRevision,
      revisadaAt: row.revisadaAt,
    };
  }
  private maskSensitiveData(value: Prisma.JsonValue): Prisma.JsonValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result: Record<string, Prisma.JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toUpperCase();
      result[key] =
        normalizedKey.includes('APP') ||
        normalizedKey.includes('MAC') ||
        normalizedKey.includes('ACCESS')
          ? typeof item === 'string'
            ? '[DATO OPERATIVO PROTEGIDO]'
            : null
          : (item ?? null);
    }
    return result;
  }
}

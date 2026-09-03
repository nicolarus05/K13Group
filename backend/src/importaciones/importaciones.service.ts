import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, ImportacionFila } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { normalizeName, normalizePhone } from '../common/helpers/normalization';
import { ExcelParserService, NormalizedExcelRow, ParsedExcelRow } from './excel-parser.service';
import { ConfirmarImportacionDto } from './dto/confirmar-importacion.dto';
import { ImportacionFilasDto } from './dto/importacion-filas.dto';

const IMPORT_STATUS = {
  REVIEW: 'EN_REVISION',
  COMPLETED: 'COMPLETADA',
  COMPLETED_WITH_ERRORS: 'COMPLETADA_CON_ERRORES',
  FAILED: 'FALLIDA',
} as const;

const ROW_STATUS = {
  VALIDATED: 'VALIDADA',
  CONFLICT: 'EN_CONFLICTO',
  IMPORTED: 'IMPORTADA',
  ERROR: 'ERROR',
} as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

type ImportReport = {
  clientesNuevos: number;
  posiblesDuplicados: number;
  filasPendientesReconciliacion: number;
  movimientosCreados: number;
  hojas: Array<{ hoja: string; filas: number; errores: number; advertencias: number }>;
};

type NormalizedIdentity = Pick<
  NormalizedExcelRow,
  'nombreClave' | 'telefonoNormalizado' | 'servidorClave' | 'app' | 'referenciaClave'
>;

@Injectable()
export class ImportacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelParser: ExcelParserService,
  ) {}

  async preview(file: Express.Multer.File, usuarioId: string) {
    this.validateFile(file);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.importacion.findUnique({ where: { checksum } });
    if (existing) return this.getImportacion(existing.id);

    let parsedSheets;
    try {
      parsedSheets = this.excelParser.parse(file.buffer);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'No se pudo leer el Excel.');
    }

    const parsedRows = parsedSheets.flatMap((sheet) => sheet.filas);
    if (parsedRows.length === 0) {
      throw new BadRequestException('El Excel no contiene filas operativas con nombre.');
    }

    const existingClients = await this.prisma.cliente.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, telefono: true, telefonoNormalizado: true },
    });
    const existingPhones = new Set(
      existingClients.map((client) => normalizePhone(client.telefonoNormalizado ?? client.telefono)).filter(Boolean),
    );
    const existingNames = new Set(existingClients.map((client) => normalizeName(client.nombre)));
    const identityKeys = new Set<string>();
    const identityCounts = new Map<string, number>();

    for (const row of parsedRows) {
      const identityKey = this.identityKey(row.datosNormalizados);
      identityKeys.add(identityKey);
      identityCounts.set(identityKey, (identityCounts.get(identityKey) ?? 0) + 1);
    }

    for (const row of parsedRows) {
      if ((identityCounts.get(this.identityKey(row.datosNormalizados)) ?? 0) > 1) {
        row.advertencias.push('Identidad repetida en el archivo; se vinculará al mismo cliente.');
      }
    }

    const clientesNuevos = [...identityKeys].filter((key) => {
      const [type, value] = key.split(':', 2);
      return type === 'phone' ? !existingPhones.has(value) : !existingNames.has(value);
    }).length;
    const posiblesDuplicados = parsedRows.filter(
      (row) => (identityCounts.get(this.identityKey(row.datosNormalizados)) ?? 0) > 1,
    ).length;

    const errores = parsedSheets.reduce((count, sheet) => count + sheet.errores.length, 0);
    const advertencias = parsedRows.reduce((count, row) => count + row.advertencias.length, 0);
    const report: ImportReport = {
      clientesNuevos,
      posiblesDuplicados,
      filasPendientesReconciliacion: parsedRows.filter((row) => this.needsFinancialReview(row)).length,
      movimientosCreados: 0,
      hojas: parsedSheets.map((sheet) => ({
        hoja: sheet.hoja,
        filas: sheet.filas.length,
        errores: sheet.errores.length,
        advertencias: sheet.filas.reduce((count, row) => count + row.advertencias.length, 0),
      })),
    };

    const importacion = await this.prisma.$transaction(async (tx) => {
      const created = await tx.importacion.create({
        data: {
          archivo: file.originalname.slice(0, 255),
          usuarioId,
          checksum,
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
          hojaOrigen: row.hojaOrigen.slice(0, 20),
          filaOrigen: row.filaOrigen,
          hashFila: row.hashFila,
          datosOriginales: row.datosOriginales as Prisma.InputJsonValue,
          datosNormalizados: row.datosNormalizados as unknown as Prisma.InputJsonValue,
          estado: row.errores.length ? ROW_STATUS.ERROR : ROW_STATUS.VALIDATED,
          errores: row.errores as unknown as Prisma.InputJsonValue,
          advertencias: row.advertencias as unknown as Prisma.InputJsonValue,
        })),
      });

      return created;
    });

    return this.toSummary(importacion, report);
  }

  async confirm(
    id: string,
    usuarioId: string,
    idempotencyKey: string | undefined,
    dto: ConfirmarImportacionDto,
  ) {
    if (!dto.confirmar) throw new BadRequestException('La confirmación explícita es obligatoria.');
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Falta la cabecera Idempotency-Key.');
    }

    const current = await this.prisma.importacion.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Importación ${id} no encontrada.`);
    if ([IMPORT_STATUS.COMPLETED, IMPORT_STATUS.COMPLETED_WITH_ERRORS].includes(current.estado as never)) {
      return this.getImportacion(id);
    }
    if (current.estado !== IMPORT_STATUS.REVIEW) {
      throw new ConflictException(`La importación está en estado ${current.estado}.`);
    }
    if (current.errores > 0) {
      throw new BadRequestException('La importación contiene errores bloqueantes.');
    }
    if (current.advertencias > 0 && !dto.permitirAdvertencias) {
      throw new BadRequestException('Debes aceptar las advertencias antes de confirmar.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.importacion.updateMany({
        where: { id, estado: IMPORT_STATUS.REVIEW },
        data: { estado: 'EN_PROCESO' },
      });
      const importacion = await tx.importacion.findUnique({
        where: { id },
        include: { filas: { orderBy: [{ hojaOrigen: 'asc' }, { filaOrigen: 'asc' }] } },
      });
      if (!importacion) throw new NotFoundException(`Importación ${id} no encontrada.`);
      if (claimed.count === 0) return importacion;

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

      const rowUpdates = new Map<string, { clienteId: string | null; estado: string; advertencias: string[] }>();
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
        let clienteId = phone ? byPhone.get(phone) ?? undefined : undefined;
        if (!clienteId && phone && byPhone.has(phone)) {
          rowUpdates.set(row.id, {
            clienteId: null,
            estado: ROW_STATUS.CONFLICT,
            advertencias: [...this.jsonStringArray(row.advertencias), 'Teléfono asociado a más de un cliente.'],
          });
          omittedRows += 1;
          continue;
        }
        if (!clienteId && name) clienteId = byName.get(name) ?? undefined;
        if (!clienteId && name && byName.has(name)) {
          rowUpdates.set(row.id, {
            clienteId: null,
            estado: ROW_STATUS.CONFLICT,
            advertencias: [...this.jsonStringArray(row.advertencias), 'Nombre asociado a más de un cliente.'],
          });
          omittedRows += 1;
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

        const warnings = this.jsonStringArray(row.advertencias);
        if (!phone) warnings.push('Cliente creado o vinculado sin teléfono normalizado; revisar identidad.');
        if (this.needsFinancialReview({ datosNormalizados: normalized, advertencias: warnings } as ParsedExcelRow)) {
          pendingReviewRows += 1;
        }
        rowUpdates.set(row.id, {
          clienteId: clienteId ?? null,
          estado: clienteId ? ROW_STATUS.IMPORTED : ROW_STATUS.ERROR,
          advertencias: [...new Set(warnings)],
        });
        if (!clienteId) omittedRows += 1;
      }

      for (const [rowId, update] of rowUpdates) {
        await tx.importacionFila.update({
          where: { id: rowId },
          data: {
            clienteId: update.clienteId,
            estado: update.estado,
            advertencias: update.advertencias as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const report = this.readReport(importacion.informe);
      const finalReport: ImportReport = {
        ...report,
        clientesNuevos: createdClients,
        filasPendientesReconciliacion: pendingReviewRows,
        movimientosCreados: 0,
      };
      const finalStatus = omittedRows > 0 ? IMPORT_STATUS.COMPLETED_WITH_ERRORS : IMPORT_STATUS.COMPLETED;
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
    return this.toSummary(importacion, this.readReport(importacion.informe));
  }

  async getFilas(id: string, query: ImportacionFilasDto, onlyErrors = false) {
    await this.ensureImportacion(id);
    const where: Prisma.ImportacionFilaWhereInput = {
      importacionId: id,
      ...(onlyErrors ? { estado: { in: [ROW_STATUS.ERROR, ROW_STATUS.CONFLICT] } } : {}),
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

  private async ensureImportacion(id: string) {
    const exists = await this.prisma.importacion.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Importación ${id} no encontrada.`);
  }

  private validateFile(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Debes adjuntar un archivo Excel.');
    if (file.buffer.length > MAX_FILE_SIZE) throw new BadRequestException('El Excel supera el límite de 10 MB.');
    const filename = file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      throw new BadRequestException('Solo se admiten archivos .xlsx o .xls.');
    }
  }

  private identityKey(row: NormalizedIdentity): string {
    if (row.telefonoNormalizado) return `phone:${row.telefonoNormalizado}`;
    return `name:${row.nombreClave}`;
  }

  private needsFinancialReview(row: Pick<ParsedExcelRow, 'datosNormalizados' | 'advertencias'>): boolean {
    return (
      row.datosNormalizados.total === null ||
      !row.datosNormalizados.pago ||
      row.datosNormalizados.total === 0 ||
      row.advertencias.some((warning) => warning.includes('Fecha fuera') || warning.includes('FECHA'))
    );
  }

  private jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private readReport(value: Prisma.JsonValue | null): ImportReport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { clientesNuevos: 0, posiblesDuplicados: 0, filasPendientesReconciliacion: 0, movimientosCreados: 0, hojas: [] };
    }
    const report = value as Record<string, Prisma.JsonValue>;
    return {
      clientesNuevos: Number(report.clientesNuevos ?? 0),
      posiblesDuplicados: Number(report.posiblesDuplicados ?? 0),
      filasPendientesReconciliacion: Number(report.filasPendientesReconciliacion ?? 0),
      movimientosCreados: Number(report.movimientosCreados ?? 0),
      hojas: Array.isArray(report.hojas) ? report.hojas as unknown as ImportReport['hojas'] : [],
    };
  }

  private toSummary(importacion: { id: string; archivo: string; checksum: string | null; estado: string; registros: number; errores: number; advertencias: number; fechaInicio: Date | null; fechaFin: Date | null }, report: ImportReport) {
    return {
      importacionId: importacion.id,
      archivo: importacion.archivo,
      checksum: importacion.checksum,
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
    return {
      id: row.id,
      hojaOrigen: row.hojaOrigen,
      filaOrigen: row.filaOrigen,
      hashFila: row.hashFila,
      estado: row.estado,
      datosOriginales: this.maskSensitiveData(row.datosOriginales),
      datosNormalizados: row.datosNormalizados,
      errores: row.errores,
      advertencias: row.advertencias,
      clienteId: row.clienteId,
      suscripcionId: row.suscripcionId,
      renovacionId: row.renovacionId,
      movimientoId: row.movimientoId,
    };
  }

  private maskSensitiveData(value: Prisma.JsonValue): Prisma.JsonValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result: Record<string, Prisma.JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toUpperCase();
      if (normalizedKey.includes('APP') || normalizedKey.includes('MAC') || normalizedKey.includes('ACCESS')) {
        result[key] = typeof item === 'string' ? '[DATO OPERATIVO PROTEGIDO]' : null;
      } else {
        result[key] = item ?? null;
      }
    }
    return result;
  }
}

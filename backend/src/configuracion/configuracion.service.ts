import { safeAuditData } from '../auditoria/audit-data';
import { RecoveryService } from '../recovery/recovery.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  readSettings,
  ranges,
  revision,
  bumpRevision,
  settingsLock,
  validSetting,
} from './settings';
import { EditSettingsDto, LogoDto } from './configuracion.dto';
import { verifyPassword, lockUser } from '../users/account';
import { mkdir, writeFile, readFile, unlink, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const sharp: typeof import('sharp').default = require('sharp');
export const assetRoot = () => process.env.ASSET_DIR || '/tmp/k13-assets';
@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: RecoveryService,
  ) {}
  get() {
    return this.prisma.$transaction(
      async (tx) => ({
        valores: await readSettings(tx),
        version: await revision(tx),
        actualizadoAt:
          (
            await tx.actividad.findFirst({
              where: { tabla: 'configuracion' },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            })
          )?.createdAt ?? null,
        limites: ranges,
        fijos: {
          moneda: 'EUR',
          idioma: 'es',
          zona: 'Europe/Madrid',
          renovacion: 'Anual; tardía desde la renovación',
        },
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async update(dto: EditSettingsDto, actor: string, internal = false) {
    const changes = Object.fromEntries(
      Object.entries(dto.cambios).map(([k, v]) => [k, validSetting(k, v, internal)]),
    );
    if (!Object.keys(changes).length) throw new BadRequestException('No hay cambios.');
    return this.prisma.$transaction(async (tx) => {
      // Mismo orden en todos los cambios: usuario, ajustes y auditoría.
      await lockUser(tx, actor);
      if (
        Object.keys(changes).some(
          (k) =>
            k.startsWith('seguridad.') ||
            k.startsWith('copias.') ||
            k.startsWith('sistema.') ||
            k === 'interfaz.refresco_indicadores_segundos',
        )
      ) {
        await verifyPassword(tx, actor, dto.password);
      }
      await settingsLock(tx);
      const version = await revision(tx);
      if (dto.version !== version)
        throw new ConflictException('Los ajustes han cambiado. Recarga antes de guardar.');
      const before = await readSettings(tx);
      for (const [clave, valor] of Object.entries(changes))
        await tx.configuracion.upsert({
          where: { clave },
          create: { clave, valor: String(valor) },
          update: { valor: String(valor) },
        });
      await bumpRevision(tx, version + 1);
      await tx.actividad.create({
        data: {
          usuarioId: actor,
          tabla: 'configuracion',
          accion: 'EDITAR',
          datosAnteriores: before,
          datosNuevos: {
            cambios: changes as Prisma.InputJsonObject,
            motivo: dto.motivo,
            version: version + 1,
          },
        },
      });
      return { valores: await readSettings(tx), version: version + 1 };
    });
  }
  async logo(file: Express.Multer.File | undefined, dto: LogoDto, actor: string) {
    if (!file || file.size > 2 * 1024 * 1024)
      throw new BadRequestException('Selecciona una imagen de hasta 2 MB.');
    let buffer: Buffer;
    try {
      const img = sharp(file.buffer, { limitInputPixels: 16000000 });
      const meta = await img.metadata();
      if (
        !['png', 'jpeg', 'webp'].includes(meta.format ?? '') ||
        (meta.pages ?? 1) > 1 ||
        !meta.width ||
        !meta.height
      )
        throw new Error();
      if (file.mimetype !== `image/${meta.format}`) throw new Error();
      buffer = await img
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .webp()
        .toBuffer();
    } catch {
      throw new BadRequestException('Imagen PNG, JPEG o WebP inválida o demasiado grande.');
    }
    const id = randomUUID();
    await mkdir(assetRoot(), { recursive: true, mode: 0o700 });
    const path = join(assetRoot(), id + '.webp');
    await writeFile(path, buffer, { flag: 'wx', mode: 0o600 });
    try {
      return await this.update({ ...dto, cambios: { 'negocio.logo_asset_id': id } }, actor, true);
    } catch (e) {
      await unlink(path);
      throw e;
    }
  }
  async image(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new NotFoundException();
    try {
      return await readFile(join(assetRoot(), id + '.webp'));
    } catch {
      throw new NotFoundException();
    }
  }
  async history(page: number, limit: number) {
    const where = { tabla: { in: ['configuracion', 'cuenta', 'copias_seguridad'] } };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.actividad.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { usuario: { select: { nombre: true } } },
      }),
      this.prisma.actividad.count({ where }),
    ]);
    return {
      data: data.map((r) => ({
        ...r,
        datosAnteriores: safeAuditData(r.datosAnteriores),
        datosNuevos: safeAuditData(r.datosNuevos),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
  async system() {
    await this.prisma.$queryRaw`SELECT 1`;
    const [migrations, lastImport, lastExport] = await Promise.all([
      this.prisma.$queryRaw<
        { migration_name: string }[]
      >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
      this.prisma.importacion.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, estado: true },
      }),
      this.prisma.exportacion.findFirst({
        where: { estado: 'GENERADA' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, tipo: true },
      }),
    ]);
    const lastCopy = (await this.recovery.list().catch(() => []))[0] ?? null;
    const lastJob = await this.recovery.lastJob();
    const disk = process.env.RECOVERY_DIR
      ? await statfs(process.env.RECOVERY_DIR).catch(() => null)
      : null;
    return {
      database: 'Disponible',
      version: '0.1.0 / Sprint 11',
      ultimaCopia: lastCopy,
      ultimaOperacionCopia: lastJob,
      migraciones: migrations.map((m) => m.migration_name),
      ultimaImportacion: lastImport,
      ultimaExportacion: lastExport,
      espacioLibre: disk ? String(disk.bavail * disk.bsize) : null,
    };
  }
}

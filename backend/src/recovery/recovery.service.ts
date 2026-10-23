import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, rm, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { verifyPassword } from '../users/account';
import { RecoveryDto } from './recovery.dto';
export type Job = {
  id: string;
  action: string;
  state: string;
  phase: string;
  copyId?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};
export type Backup = {
  id: string;
  state: string;
  size: string;
  createdAt: string;
  checksum: string;
  validatedAt?: string;
  automatic?: boolean;
};
@Injectable()
export class RecoveryService {
  constructor(private readonly prisma: PrismaService) {}
  root() {
    if (!process.env.RECOVERY_DIR || !process.env.RECOVERY_SECRET)
      throw new ServiceUnavailableException('Recuperación no configurada.');
    return process.env.RECOVERY_DIR;
  }
  sign(value: string) {
    return createHmac('sha256', process.env.RECOVERY_SECRET!).update(value).digest('hex');
  }
  async json<T>(name: string): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.root(), name), 'utf8'));
    } catch {
      throw new NotFoundException('Registro no disponible.');
    }
  }
  async list() {
    const root = this.root();
    await mkdir(join(root, 'copies'), { recursive: true });
    const files = (await readdir(join(root, 'copies'))).filter((f) =>
      /^[a-f0-9-]{36}\.json$/.test(f),
    );
    const rows = await Promise.all(files.map((f) => this.json<Backup>('copies/' + f)));
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ id, state, size, createdAt, checksum, validatedAt, automatic }) => ({
        id,
        state,
        size,
        createdAt,
        checksum,
        validatedAt,
        automatic,
      }));
  }
  async metadata(id: string) {
    const rows = await this.list();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException('Copia no disponible.');
    return row;
  }
  async lastJob() {
    try {
      const files = (await readdir(join(this.root(), 'jobs'))).filter((f) =>
        /^[a-f0-9-]{36}\.json$/.test(f),
      );
      const jobs = await Promise.all(files.map((f) => this.json<Job>('jobs/' + f)));
      const last = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!last) return null;
      const { id, state, phase, createdAt, finishedAt, action, copyId, error } = last;
      return { id, state, phase, createdAt, finishedAt, action, copyId, error };
    } catch {
      return null;
    }
  }
  async heartbeat() {
    try {
      const time = (await stat(join(this.root(), 'heartbeat'))).mtimeMs;
      return Date.now() - time < 15000;
    } catch {
      return false;
    }
  }
  async submit(action: string, dto: RecoveryDto, actor: string, copyId?: string) {
    await verifyPassword(this.prisma, actor, dto.password);
    const root = this.root();
    const id = dto.solicitudId;
    const fingerprint = this.sign(JSON.stringify({ action, actor, copyId }));
    const existingTicket = async () => {
      const existing = await this.json<Job & { fingerprint: string }>('jobs/' + id + '.json').catch(
        () => null,
      );
      if (!existing) return null;
      if (existing.fingerprint !== fingerprint)
        throw new ConflictException('Solicitud utilizada para otra acción.');
      return { id, token: this.statusToken(id) };
    };
    const previous = await existingTicket();
    if (previous) return previous;
    if (!(await this.heartbeat()))
      throw new ServiceUnavailableException('El servicio de copias no está disponible.');
    let checksum: string | undefined;
    if (copyId) {
      const copy = await this.json<Backup>('copies/' + copyId + '.json');
      checksum = copy.checksum;
      if (copy.state !== 'COMPLETADA') throw new ConflictException('Copia no disponible.');
      if (action === 'restore' && dto.confirmacion !== copy.id)
        throw new ForbiddenException('Escribe el identificador de la copia para confirmar.');
    }
    await mkdir(join(root, 'jobs'), { recursive: true });
    const lock = join(root, 'dispatch.lock');
    try {
      await mkdir(lock);
    } catch {
      throw new ConflictException('Otra solicitud se está registrando. Reintenta.');
    }
    try {
      const accepted = await existingTicket();
      if (accepted) return accepted;
      for (const f of await readdir(join(root, 'jobs'))) {
        if (!/^[a-f0-9-]{36}\.json$/.test(f)) continue;
        const job = await this.json<Job>('jobs/' + f);
        if (['PENDIENTE', 'EJECUTANDO'].includes(job.state))
          throw new ConflictException('Hay una operación de copia o recuperación en curso.');
      }
      const payload = JSON.stringify({
        id,
        action,
        actor,
        copyId,
        checksum,
        issued: Date.now(),
        fingerprint,
      });
      const envelope = { payload, mac: this.sign(payload) };
      await this.atomic('jobs/' + id + '.json', {
        id,
        action,
        copyId,
        state: 'PENDIENTE',
        phase: 'En cola',
        createdAt: new Date().toISOString(),
        fingerprint,
      });
      try {
        await this.atomic('jobs/' + id + '.request', envelope);
      } catch (e) {
        await rm(join(root, 'jobs', id + '.json'), { force: true });
        throw e;
      }
      return { id, token: this.statusToken(id) };
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  async atomic(name: string, value: unknown) {
    const target = join(this.root(), name);
    const temp = target + '.tmp';
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, target);
  }
  statusToken(id: string) {
    const payload = Buffer.from(JSON.stringify({ id, expires: Date.now() + 7200000 })).toString(
      'base64url',
    );
    return payload + '.' + this.sign(payload);
  }
  async status(id: string, token: string) {
    this.root();
    const [payload, signature] = token.split('.');
    const expected = this.sign(payload || '');
    if (
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new ForbiddenException();
    let data: { id: string; expires: number };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new ForbiddenException();
    }
    if (data.id !== id || !Number.isFinite(data.expires) || data.expires < Date.now())
      throw new ForbiddenException();
    const { state, phase, error, createdAt, finishedAt, action, copyId } = await this.json<Job>(
      'jobs/' + id + '.json',
    );
    return { id, state, phase, error, createdAt, finishedAt, action, copyId };
  }
  async download(id: string, password: string, actor: string) {
    await verifyPassword(this.prisma, actor, password);
    const copy = await this.json<Backup>('copies/' + id + '.json');
    if (copy.state !== 'COMPLETADA') throw new ConflictException('Copia no disponible.');
    const path = join(this.root(), 'copies', id + '.tar');
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      // Abrir antes de auditar: el descriptor sigue siendo válido si se elimina el archivo.
      handle = await open(path, 'r');
    } catch {
      throw new NotFoundException('Archivo no disponible.');
    }
    try {
      await this.prisma.actividad.create({
        data: { usuarioId: actor, tabla: 'copias_seguridad', registroId: id, accion: 'DESCARGAR' },
      });
      return handle.createReadStream();
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}

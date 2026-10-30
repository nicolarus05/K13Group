import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { businessDay, datedState, DATE_STATES } from '../suscripciones/subscription-dates';
import { warningDays } from '../configuracion/settings';
import {
  plantillaInicial,
  plantillasIniciales,
  validarTextoPlantilla,
  variablesMensaje,
} from './plantillas';

const prefix = 'mensajes.plantilla.';
@Injectable()
export class MensajesService {
  constructor(private readonly db: PrismaService) {}
  private template(tipo: string, valor?: string) {
    const initial = plantillaInicial(tipo);
    const saved = valor ? (JSON.parse(valor) as { texto: string; version: number }) : null;
    return {
      tipo,
      nombre: initial.nombre,
      texto: saved?.texto ?? initial.texto,
      version: saved?.version ?? 0,
      textoInicial: initial.texto,
    };
  }
  async list() {
    const rows = await this.db.configuracion.findMany({
      where: { clave: { in: plantillasIniciales.map((p) => prefix + p.tipo) } },
    });
    return {
      variables: variablesMensaje,
      plantillas: plantillasIniciales.map((p) =>
        this.template(p.tipo, rows.find((r) => r.clave === prefix + p.tipo)?.valor),
      ),
    };
  }
  async save(tipo: string, dto: { texto: string; version: number }, actor: string) {
    plantillaInicial(tipo);
    const texto = validarTextoPlantilla(dto.texto);
    return this.db.$transaction(async (tx) => {
      const clave = prefix + tipo;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${clave}))`;
      const before = await tx.configuracion.findUnique({ where: { clave } });
      const current = this.template(tipo, before?.valor);
      if (current.version !== dto.version)
        throw new ConflictException(
          'La plantilla ha cambiado. Tu borrador se conserva; recarga la versión guardada antes de volver a guardar.',
        );
      const version = current.version + 1;
      const value = JSON.stringify({ texto, version });
      const saved = await tx.configuracion.upsert({
        where: { clave },
        create: { clave, valor: value },
        update: { valor: value },
      });
      // Nunca registrar el texto: podría contener datos personales escritos a mano.
      await tx.actividad.create({
        data: {
          usuarioId: actor,
          tabla: 'plantillas_mensajes',
          registroId: saved.id,
          accion: 'EDITAR',
          datosAnteriores: { tipo, version: current.version },
          datosNuevos: { tipo, version },
        },
      });
      return this.template(tipo, value);
    });
  }
  async context(clienteId: string) {
    return this.db.$transaction(
      async (tx) => {
        const client = await tx.cliente.findFirst({
          where: { id: clienteId, deletedAt: null },
          select: { id: true, nombre: true },
        });
        if (!client) throw new NotFoundException('Cliente no disponible.');
        const days = await warningDays(tx),
          today = businessDay();
        const subscriptions = await tx.suscripcion.findMany({
          where: { clienteId, deletedAt: null },
          orderBy: [{ fechaFin: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            fechaInicio: true,
            fechaFin: true,
            version: true,
            producto: { select: { nombre: true } },
            servidor: { select: { nombre: true } },
            estado: { select: { valor: true } },
            renovaciones: {
              where: { deletedAt: null, estado: { valor: 'COMPLETADA' } },
              orderBy: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
              select: {
                id: true,
                fechaInicio: true,
                fechaFin: true,
                tipoOperacion: true,
                productoNombreSnapshot: true,
                metodoPago: { select: { esGratuito: true } },
                movimientos: {
                  where: {
                    tipo: { valor: 'INGRESO' },
                    estado: { valor: { in: ['CONFIRMADO', 'PENDIENTE'] } },
                  },
                  select: { importe: true, estado: { select: { valor: true } } },
                },
              },
            },
          },
        });
        return {
          cliente: client,
          suscripciones: subscriptions.map((s) => ({
            id: s.id,
            version: s.version,
            aplicacion: s.producto.nombre,
            servidor: s.servidor.nombre,
            inicio: s.fechaInicio.toISOString().slice(0, 10),
            vencimiento: s.fechaFin.toISOString().slice(0, 10),
            estado: (DATE_STATES as readonly string[]).includes(s.estado.valor)
              ? datedState(s.fechaFin, today, days)
              : s.estado.valor,
            periodos: s.renovaciones.map((p) => {
              const sum = (state: string) =>
                p.movimientos
                  .filter((m) => m.estado.valor === state)
                  .reduce((total, m) => total.plus(m.importe), new Prisma.Decimal(0));
              const paid = sum('CONFIRMADO'),
                pending = sum('PENDIENTE'),
                known = p.metodoPago.esGratuito || p.movimientos.length > 0;
              return {
                id: p.id,
                inicio: p.fechaInicio.toISOString().slice(0, 10),
                vencimiento: p.fechaFin.toISOString().slice(0, 10),
                tipo: p.tipoOperacion,
                aplicacion: p.productoNombreSnapshot ?? s.producto.nombre,
                pagado: known ? paid.toFixed(2) : null,
                pendiente: known ? pending.toFixed(2) : null,
                estadoPago: p.metodoPago.esGratuito
                  ? 'Gratuito'
                  : !known
                    ? 'Sin registro de cobro'
                    : pending.gt(0)
                      ? paid.gt(0)
                        ? 'Pago parcial'
                        : 'Pendiente'
                      : 'Pagado',
              };
            }),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

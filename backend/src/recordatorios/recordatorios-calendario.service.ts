import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { businessDay, parseDay } from '../suscripciones/subscription-dates';
import { buildPaginatedResponse } from '../common/helpers/response.helper';
import { ReminderQueryDto } from './recordatorios.dto';

// Una fila por obligación; los avisos automáticos se unen, nunca se suman otra vez.
const events = Prisma.sql`WITH eventos AS (
  SELECT 'R:' || s.id::text AS clave, 'RENOVACION' AS tipo,
    CASE WHEN re.valor = 'POSPUESTO' THEN r.fecha ELSE s.fecha_fin END AS fecha,
    s.fecha_fin AS "fechaOriginal", c.id AS "clienteId", c.nombre AS cliente,
    s.id AS "suscripcionId", NULL::uuid AS "renovacionId", r.id AS "recordatorioId",
    re.valor AS "estadoAviso", 'Renovación anual'::text AS descripcion
  FROM suscripciones s JOIN clientes c ON c.id = s.cliente_id
  JOIN estados se ON se.id = s.estado_id JOIN estados ce ON ce.id = c.estado_id
  LEFT JOIN recordatorios r ON r.clave_automatica = 'R:' || s.id::text || ':' || to_char(s.fecha_fin, 'YYYY-MM-DD')
  LEFT JOIN estados re ON re.id = r.estado_id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND ce.valor = 'ACTIVO'
    AND NOT s.no_renovar AND se.valor IN ('ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA')
  UNION ALL
  SELECT 'C:' || m.id::text, 'COBRO',
    CASE WHEN re.valor = 'POSPUESTO' THEN r.fecha ELSE COALESCE(m.fecha_prevista_cobro, (m.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date) END,
    COALESCE(m.fecha_prevista_cobro, (m.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date),
    c.id, c.nombre, s.id, m.renovacion_id, r.id, re.valor, 'Cobro pendiente · ' || m.importe::text || ' €'
  FROM movimientos_financieros m JOIN estados me ON me.id = m.estado_id
  JOIN estados mt ON mt.id = m.tipo_id JOIN suscripciones s ON s.id = m.suscripcion_id
  JOIN clientes c ON c.id = s.cliente_id
  LEFT JOIN recordatorios r ON r.clave_automatica = 'C:' || m.renovacion_id::text
  LEFT JOIN estados re ON re.id = r.estado_id
  WHERE me.valor = 'PENDIENTE' AND mt.valor = 'INGRESO'
  UNION ALL
  SELECT 'M:' || r.id::text, rt.valor, r.fecha, COALESCE(r.fecha_original, r.fecha),
    c.id, c.nombre, r.suscripcion_id, NULL::uuid, r.id, re.valor, r.descripcion
  FROM recordatorios r JOIN clientes c ON c.id = r.cliente_id
  JOIN estados rt ON rt.id = r.tipo_id JOIN estados re ON re.id = r.estado_id
  WHERE r.origen <> 'AUTOMATICO' AND c.deleted_at IS NULL AND re.valor IN ('PENDIENTE', 'POSPUESTO')
)`;

@Injectable()
export class RecordatoriosCalendarioService {
  constructor(private readonly prisma: PrismaService) {}
  private filter(q: ReminderQueryDto) {
    const from = parseDay(q.desde ?? businessDay()),
      to = parseDay(q.hasta ?? q.desde ?? businessDay());
    if (to < from || to.getTime() - from.getTime() > 61 * 86400000)
      throw new BadRequestException('El calendario admite un intervalo de 1 a 62 días.');
    return Prisma.sql`fecha >= ${from}::date AND fecha <= ${to}::date
      ${q.clienteId ? Prisma.sql`AND "clienteId" = ${q.clienteId}::uuid` : Prisma.empty}
      ${q.tipo ? Prisma.sql`AND tipo = ${q.tipo}` : Prisma.empty}
      ${q.search?.trim() ? Prisma.sql`AND strpos(lower(cliente), lower(${q.search.trim()})) > 0` : Prisma.empty}`;
  }
  async calendar(q: ReminderQueryDto) {
    return this.prisma.$queryRaw<
      { fecha: string; total: number; renovaciones: number; cobros: number }[]
    >(Prisma.sql`${events}
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, count(*)::int AS total,
        count(*) FILTER (WHERE tipo = 'RENOVACION')::int AS renovaciones,
        count(*) FILTER (WHERE tipo = 'COBRO')::int AS cobros
      FROM eventos WHERE ${this.filter(q)} GROUP BY fecha ORDER BY fecha`);
  }
  async agenda(q: ReminderQueryDto) {
    const where = this.filter(q);
    return this.prisma.$transaction(
      async (tx) => {
        const rows = (await tx.$queryRaw(Prisma.sql`${events} SELECT clave, tipo,
        to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char("fechaOriginal", 'YYYY-MM-DD') AS "fechaOriginal",
        "clienteId", cliente, "suscripcionId", "renovacionId", "recordatorioId", "estadoAviso", descripcion
        FROM eventos WHERE ${where} ORDER BY fecha, clave LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`)) as Record<
          string,
          unknown
        >[];
        const [count] = await tx.$queryRaw<{ total: number }[]>(
          Prisma.sql`${events} SELECT count(*)::int AS total FROM eventos WHERE ${where}`,
        );
        return buildPaginatedResponse(rows, count.total, q.page, q.limit);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

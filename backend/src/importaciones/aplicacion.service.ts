import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../database/prisma.service';
import { lockCatalog } from '../catalogos/catalogos.service';
import {
  audit,
  stateId,
  subscriptionLock,
  warningDays,
} from '../recordatorios/recordatorios.service';
import { businessDay, datedState, parseDay } from '../suscripciones/subscription-dates';
import { normalizeComparable } from '../common/helpers/normalization';
import { EquivalenciasRevisionService } from './equivalencias-revision.service';
import { identityData, identityHash, identityPhone } from './identity-matching';
import { record } from './equivalence-rules';
import { AplicacionQueryDto, ConfirmarLoteDto, ProponerImportacionDto } from './dto/aplicacion.dto';

// Invalida propuestas anteriores cuando cambia el contrato de confirmación.
const APPLICATION_REVISION = '12.4.1';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const selectionContent = (value: ProponerImportacionDto) =>
  json({
    ...value,
    filas: value.filas.map((row) => ({ ...row, servicioDistinto: row.servicioDistinto ?? false })),
  });
const day = (date: Date) => date.toISOString().slice(0, 10);
const overlap = (a: string, b: string, c: string, d: string) => a < d && c < b;

@Injectable()
export class AplicacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly equivalences: EquivalenciasRevisionService,
  ) {}

  private async context(tx: Prisma.TransactionClient, id: string) {
    const review = await this.equivalences.context(tx, id);
    const [subscriptions, renewals, movements, references, applied, materialized] =
      await Promise.all([
        tx.suscripcion.findMany({ include: { estado: true }, orderBy: { id: 'asc' } }),
        tx.renovacion.findMany({ include: { estado: true }, orderBy: { id: 'asc' } }),
        tx.movimientoFinanciero.findMany({ orderBy: { id: 'asc' } }),
        tx.referencia.findMany({ orderBy: { id: 'asc' } }),
        tx.importacionFila.findMany({
          where: { suscripcionId: { not: null } },
          select: {
            id: true,
            importacionId: true,
            clienteId: true,
            suscripcionId: true,
            datosNormalizados: true,
            mapeo: true,
          },
          orderBy: { id: 'asc' },
        }),
        tx.importacionIdentidad.findMany({
          where: { materializada: true },
          select: { id: true, clienteDestinoId: true, historial: true },
          orderBy: { id: 'asc' },
        }),
      ]);
    const owners = materialized.flatMap((g) => {
      const event = [...(Array.isArray(g.historial) ? g.historial : [])]
        .reverse()
        .map(record)
        .find((e) => e.accion === 'MATERIALIZAR');
      return typeof event?.referenciaId === 'string'
        ? [{ clienteId: g.clienteDestinoId, referenciaId: event.referenciaId }]
        : [];
    });
    const today = businessDay(),
      days = await warningDays(tx),
      activeClientState = await stateId(tx, 'cliente', 'ACTIVO');
    const fingerprint = identityHash([
      APPLICATION_REVISION,
      review.huellaRevision,
      review.lecturas.map((r) => [r.id, r.clienteId, r.suscripcionId, r.renovacionId]),
      subscriptions,
      renewals,
      movements,
      references,
      applied,
      owners,
      today,
      days,
    ]);
    return {
      review,
      subscriptions,
      renewals,
      movements,
      references,
      applied,
      owners,
      today,
      days,
      activeClientState,
      huellaRevision: fingerprint,
    };
  }

  async list(id: string, query: AplicacionQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const c = await this.context(tx, id);
        const raw = new Map(c.review.lecturas.map((r) => [r.id, r]));
        const groups = new Map(c.review.identidades.groups.map((g) => [g.id, g]));
        const filtered = c.review.rows.filter((r) => !query.hoja || r.hoja === query.hoja);
        const page = query.page ?? 1,
          limit = query.limit ?? 25;
        const lotesPage = query.lotesPage ?? 1;
        const [batches, totalBatches] = await Promise.all([
          tx.importacionLote.findMany({
            where: { importacionId: id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
            skip: (lotesPage - 1) * 50,
          }),
          tx.importacionLote.count({ where: { importacionId: id } }),
        ]);
        return {
          huellaRevision: c.huellaRevision,
          hojas: [...new Set(c.review.rows.map((r) => r.hoja))],
          resumen: {
            filas: c.review.rows.length,
            clientesVinculados: c.review.lecturas.filter((r) => r.clienteId).length,
            serviciosVinculados: c.review.lecturas.filter((r) => r.suscripcionId).length,
            operacionesCreadas: c.review.lecturas.filter((r) => r.renovacionId).length,
            excluidas: c.review.rows.filter((r) => r.excluida).length,
          },
          data: filtered.slice((page - 1) * limit, page * limit).map((r) => {
            const source = raw.get(r.id)!,
              g = groups.get(source.identidadId ?? '');
            const client = g?.clienteDestinoId;
            return {
              ...r,
              nombre: identityData(g?.datos).nombre,
              identidadId: g?.id ?? null,
              clienteId: source.clienteId,
              suscripcionId: source.suscripcionId,
              renovacionId: source.renovacionId,
              movimientoId: source.movimientoId,
              candidatos: c.subscriptions
                .filter(
                  (s) =>
                    !s.deletedAt &&
                    s.clienteId === client &&
                    s.productoId === r.campos.PRODUCTO.destino?.id,
                )
                .map((s) => ({
                  id: s.id,
                  fechaInicio: day(s.fechaInicio),
                  fechaFin: day(s.fechaFin),
                  estado: s.estado.etiqueta,
                  servidor:
                    c.review.catalogs.SERVIDOR.find((x) => x.id === s.servidorId)?.nombre ??
                    'Servidor histórico',
                })),
            };
          }),
          pagination: {
            page,
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / limit),
          },
          lotes: batches.map((b) => this.publicBatch(b)),
          lotesPagination: {
            page: lotesPage,
            total: totalBatches,
            totalPages: Math.ceil(totalBatches / 50),
          },
        };
      },
      { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private publicBatch(b: Prisma.ImportacionLoteGetPayload<object>) {
    return {
      id: b.id,
      autor: b.autor,
      estado: b.estado,
      motivo: b.motivo,
      fecha: b.createdAt,
      aplicadoAt: b.aplicadoAt,
      propuesta: b.propuesta,
      resultado: b.resultado,
    };
  }

  private build(c: Awaited<ReturnType<AplicacionService['context']>>, dto: ProponerImportacionDto) {
    if (dto.huellaRevision !== c.huellaRevision)
      throw new ConflictException(
        'Han cambiado los datos. Actualiza y prepara una nueva propuesta.',
      );
    const groups = new Map(c.review.identidades.groups.map((g) => [g.id, g]));
    const raw = new Map(c.review.lecturas.map((r) => [r.id, r]));
    const reviewed = new Map(c.review.rows.map((r) => [r.id, r]));
    const clients = new Map(c.review.identidades.clients.map((v) => [v.id, v]));
    const plannedClients = new Map<
      string,
      {
        identidadId: string;
        identidades: string[];
        clienteId: string | null;
        nombre: string;
        referencia: string;
        referenciaId: string | null;
        crear: boolean;
      }
    >();
    const blockers: Array<{ filaId: string; hoja: string; fila: number; motivos: string[] }> = [];
    const rows = dto.filas.map((choice) => {
      const source = raw.get(choice.filaId),
        r = reviewed.get(choice.filaId);
      if (!source || !r)
        throw new BadRequestException('La selección contiene una fila ajena al análisis.');
      const g = groups.get(source.identidadId ?? '');
      const reasons: string[] = [];
      if (!g || !['NUEVO', 'VINCULADO'].includes(r.identidad) || r.excluida)
        reasons.push('Confirma primero una identidad válida en 12.2.');
      const clientId = g?.clienteDestinoId ?? null;
      const clientKey = clientId ?? g?.id ?? source.id;
      const name = identityData(g?.datos).nombre;
      const history = Array.isArray(g?.historial) ? g.historial : [];
      const materialization = [...history]
        .reverse()
        .map(record)
        .find((e) => e.accion === 'MATERIALIZAR');
      const ownedIds = [
        ...new Set(
          c.owners.filter((o) => o.clienteId === clientId && clientId).map((o) => o.referenciaId),
        ),
      ];
      if (ownedIds.length > 1)
        reasons.push(
          'El cliente tiene referencias propias contradictorias. Revisa los lotes anteriores.',
        );
      const ownReference = c.references.find(
        (ref) => ref.id === (materialization?.referenciaId ?? ownedIds[0]),
      );
      const reference = (choice.referenciaPropia?.trim() || ownReference?.nombre || name).replace(
        /\s+/g,
        ' ',
      );
      if (
        (g?.materializada || ownReference) &&
        choice.referenciaPropia?.trim() &&
        reference !== ownReference?.nombre
      )
        reasons.push('La referencia propia ya está importada.');
      if (!reference || reference.length > 150)
        reasons.push('Revisa el nombre de la referencia propia (1–150 caracteres).');
      const refs = c.references.filter(
        (v) => normalizeComparable(v.nombre) === normalizeComparable(reference),
      );
      if (refs.length > 1 || refs.some((v) => v.deletedAt))
        reasons.push(
          'La referencia propia coincide con registros ambiguos o eliminados; indica otro nombre.',
        );
      if (
        refs.some((ref) =>
          c.owners.some((o) => o.referenciaId === ref.id && o.clienteId !== clientId),
        ) ||
        refs.some((ref) =>
          c.review.identidades.clients.some(
            (client) =>
              client.id !== clientId &&
              normalizeComparable(client.nombre) === normalizeComparable(ref.nombre),
          ),
        )
      )
        reasons.push(
          'La referencia propia coincide con la de otro cliente. Indica un nombre diferente; no se fusionarán identidades.',
        );
      const previous = plannedClients.get(clientKey);
      if (previous && previous.referencia !== reference)
        reasons.push('La misma identidad debe usar la misma referencia propia dentro del lote.');
      if (
        [...plannedClients.entries()].some(
          ([key, v]) =>
            key !== clientKey &&
            normalizeComparable(v.referencia) === normalizeComparable(reference),
        )
      )
        reasons.push(
          'Dos identidades distintas proponen la misma referencia propia. Revisa sus nombres.',
        );
      plannedClients.set(clientKey, {
        identidadId: g?.id ?? '',
        identidades: [...new Set([...(previous?.identidades ?? []), g?.id ?? ''])],
        clienteId: clientId,
        nombre: name,
        referencia: reference,
        referenciaId: refs[0]?.id ?? null,
        crear: !clientId,
      });
      if (choice.servicio === 'VINCULAR' && !choice.suscripcionId)
        reasons.push('Selecciona la suscripción de destino.');
      if (choice.servicio !== 'VINCULAR' && choice.suscripcionId)
        reasons.push('El destino existente solo corresponde a Vincular.');
      if (choice.servicio !== 'NUEVO' && (choice.grupoId || choice.servicioDistinto))
        reasons.push(
          'La agrupación y la confirmación de servicio distinto solo corresponden a servicios nuevos.',
        );
      if (source.suscripcionId && !['CONSERVAR', 'NINGUNO'].includes(choice.servicio))
        reasons.push('El servicio de esta fila ya está materializado y no se puede reemplazar.');
      if (choice.servicio === 'CONSERVAR' && !source.suscripcionId)
        reasons.push('Esta fila todavía no tiene una suscripción importada.');
      const serviceKey =
        choice.servicio === 'NUEVO'
          ? `nuevo:${choice.grupoId ?? source.id}`
          : choice.servicio === 'VINCULAR'
            ? choice.suscripcionId
            : source.suscripcionId;
      const target = c.subscriptions.find((s) => s.id === serviceKey);
      const product = r.campos.PRODUCTO.destino,
        tariff = r.campos.TARIFA.destino,
        server = r.campos.SERVIDOR.destino,
        ref = r.campos.REFERENCIA.destino,
        payment = r.campos.PAGO.destino;
      const start = r.fechaInicioPropuesta,
        end = typeof r.fechaFin === 'string' ? r.fechaFin : null;
      const normalized = record(source.datosNormalizados);
      const financial = choice.finanzas !== 'NINGUNA';
      const service = choice.servicio !== 'NINGUNO';
      if (financial && !service)
        reasons.push('Para importar finanzas debes crear, vincular o conservar una suscripción.');
      if (service && !['RESUELTA', 'HISTORICA'].includes(r.suscripcion))
        reasons.push('Revisa las equivalencias y las fechas del servicio en 12.3.');
      if (service && (!start || !end || start > c.today))
        reasons.push('El periodo histórico necesita fechas válidas y un inicio no futuro.');
      if (
        target &&
        (target.deletedAt || target.clienteId !== clientId || target.productoId !== product?.id)
      )
        reasons.push('El destino no pertenece al cliente/producto revisado o está eliminado.');
      if (service && choice.servicio !== 'NUEVO' && !target)
        reasons.push('La suscripción de destino ya no está disponible.');
      if (target && (target.estado.valor === 'HISTORICA') !== (r.suscripcion === 'HISTORICA'))
        reasons.push('No se puede convertir un servicio operativo en histórico ni al contrario.');
      if (
        target &&
        choice.servicio === 'VINCULAR' &&
        day(target.fechaInicio) === start &&
        day(target.fechaFin) === end &&
        (target.tarifaId !== tariff?.id ||
          target.servidorId !== server?.id ||
          target.referenciaId !== (ref?.id ?? null))
      )
        reasons.push(
          'El periodo actual del destino tiene otra tarifa, servidor o referencia. Revisa el servicio antes de vincularlo.',
        );
      if (
        target &&
        choice.servicio !== 'CONSERVAR' &&
        ['CANCELADA', 'SUSPENDIDA', 'BORRADOR'].includes(target.estado.valor)
      )
        reasons.push('El estado del destino requiere revisión desde Suscripciones.');
      if (service && choice.servicio !== 'CONSERVAR' && clientId && r.suscripcion !== 'HISTORICA') {
        const client = clients.get(clientId);
        if (client && client.estadoId !== c.activeClientState)
          reasons.push('Un servicio operativo requiere un cliente activo.');
        if (!client || client.deletedAt)
          reasons.push('El cliente de destino ya no está disponible.');
      }
      if (source.suscripcionId && service) {
        const frozen = record(source.mapeo);
        if (
          [
            ['productoId', product?.id],
            ['tarifaId', tariff?.id],
            ['servidorId', server?.id],
            ['referenciaId', ref?.id ?? null],
          ].some(([key, value]) => frozen[String(key)] !== value)
        )
          reasons.push('Las equivalencias no coinciden con el servicio ya importado.');
      }
      const candidates = c.subscriptions.filter(
        (s) => !s.deletedAt && s.clienteId === clientId && s.productoId === product?.id,
      );
      if (choice.servicio === 'NUEVO' && candidates.length && !choice.servicioDistinto)
        reasons.push(
          'Ya hay servicios del cliente y producto: vincula uno o confirma expresamente que es otro servicio.',
        );
      if (choice.servicio === 'CONSERVAR' && !financial)
        reasons.push(
          'Este servicio ya está importado. Selecciona una operación financiera pendiente.',
        );
      if (financial && !choice.tipoOperacion)
        reasons.push('Revisa si el periodo corresponde a un alta o una renovación.');
      if (!financial && choice.tipoOperacion)
        reasons.push('El tipo de operación solo corresponde a una operación financiera.');
      if (financial && source.renovacionId)
        reasons.push('La operación financiera de esta fila ya está importada.');
      if (financial && r.campos.PAGO.estado !== 'RESUELTA')
        reasons.push('El método de pago está pendiente o ha cambiado.');
      if (choice.finanzas === 'COBRADO' && r.finanzas !== 'PENDIENTE_CONFIRMACION')
        reasons.push(
          'Solo se puede confirmar un cobro monetario revisado. PE nunca se confirma como cobrado.',
        );
      if (
        choice.finanzas === 'DEUDA' &&
        (r.finanzas !== 'PENDIENTE_PAGO' ||
          !payment ||
          payment.esGratuito ||
          r.importeAnual === null ||
          r.importeAnual <= 0)
      )
        reasons.push('La deuda requiere PE, importe positivo y método de pago revisado.');
      if (choice.finanzas === 'GRATIS' && r.finanzas !== 'GRATUITO')
        reasons.push('Gratis requiere método gratuito e importe cero revisados.');
      if (service && start && target) {
        const existing = c.renewals.filter(
          (x) => x.suscripcionId === target.id && !x.deletedAt && x.estado?.valor !== 'ANULADA',
        );
        if (
          choice.tipoOperacion === 'ALTA' &&
          (existing.some((x) => x.tipoOperacion === 'ALTA' || day(x.fechaInicio) < start) ||
            day(target.fechaInicio) < start ||
            c.applied.some(
              (a) =>
                a.suscripcionId === target.id &&
                typeof record(a.mapeo).fechaInicio === 'string' &&
                (record(a.mapeo).fechaInicio as string) < start,
            ))
        )
          reasons.push('Ya existe un alta o un periodo anterior para este servicio.');
        if (
          choice.tipoOperacion === 'RENOVACION' &&
          existing.some((x) => x.tipoOperacion === 'ALTA' && day(x.fechaInicio) > start)
        )
          reasons.push('La renovación propuesta es anterior al alta existente.');
        if (existing.some((x) => overlap(start, end!, day(x.fechaInicio), day(x.fechaFin))))
          reasons.push('El periodo coincide o se solapa con una operación existente.');
        if (c.movements.some((x) => x.suscripcionId === target.id && !x.renovacionId))
          reasons.push(
            'El servicio tiene movimientos sin operación vinculada; requiere conciliación manual.',
          );
      }
      if (service && start && target && !source.suscripcionId) {
        const same = day(target.fechaInicio) === start && day(target.fechaFin) === end;
        if (!same && overlap(start, end!, day(target.fechaInicio), day(target.fechaFin)))
          reasons.push('El periodo se solapa con el periodo actual de la suscripción.');
      }
      if (
        service &&
        !source.suscripcionId &&
        target &&
        c.applied.some(
          (a) =>
            a.id !== source.id &&
            a.suscripcionId === target.id &&
            typeof record(a.mapeo).fechaInicio === 'string' &&
            typeof record(a.mapeo).fechaFin === 'string' &&
            overlap(
              start!,
              end!,
              record(a.mapeo).fechaInicio as string,
              record(a.mapeo).fechaFin as string,
            ),
        )
      )
        reasons.push(
          'Ese periodo ya fue importado desde otra fila o archivo. Retoma su fila original.',
        );
      if (!service && source.clienteId)
        reasons.push(
          'El cliente de esta fila ya está vinculado; selecciona una operación pendiente.',
        );
      if (reasons.length)
        blockers.push({ filaId: source.id, hoja: r.hoja, fila: r.fila, motivos: reasons });
      return {
        filaId: source.id,
        hoja: r.hoja,
        fila: r.fila,
        choice,
        clientKey,
        identidadId: g?.id ?? '',
        clienteId: clientId,
        nombre: name,
        serviceKey: service ? (serviceKey ?? null) : null,
        productoId: product?.id ?? null,
        tarifaId: tariff?.id ?? null,
        servidorId: server?.id ?? null,
        referenciaId: ref?.id ?? null,
        metodoPagoId: payment?.id ?? null,
        producto: product?.nombre ?? null,
        tarifa: tariff?.nombre ?? null,
        servidor: server?.nombre ?? null,
        referencia: ref?.nombre ?? null,
        metodoPago: payment?.nombre ?? null,
        fechaInicio: start,
        fechaFin: end,
        importe: r.importeAnual,
        historica: r.suscripcion === 'HISTORICA',
        tipoDispositivo:
          typeof normalized.tipoDispositivo === 'string' ? normalized.tipoDispositivo : null,
        identificadorOperativoHash:
          typeof normalized.identificadorOperativoHash === 'string'
            ? normalized.identificadorOperativoHash
            : null,
      };
    });
    const services = new Map<string, typeof rows>();
    for (const row of rows)
      if (row.serviceKey)
        services.set(row.serviceKey, [...(services.get(row.serviceKey) ?? []), row]);
    for (const group of services.values()) {
      const sorted = [...group].sort((a, b) =>
        (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? ''),
      );
      for (let i = 0; i < sorted.length; i++) {
        const row = sorted[i];
        const why: string[] = [];
        if (
          group.some(
            (other) => other.clientKey !== row.clientKey || other.productoId !== row.productoId,
          )
        )
          why.push('Un grupo de servicio debe pertenecer al mismo cliente y producto.');
        if (row.choice.tipoOperacion === 'ALTA' && i > 0)
          why.push(
            'El alta debe ser el primer periodo del servicio; los posteriores son renovaciones.',
          );
        if (group.some((other) => other.historica !== row.historica))
          why.push('Separa los servicios operativos y los exclusivamente históricos.');
        if (
          i &&
          row.fechaInicio &&
          sorted[i - 1].fechaFin &&
          row.fechaInicio < sorted[i - 1].fechaFin!
        )
          why.push(
            'Dos filas seleccionadas representan periodos repetidos o solapados del mismo servicio.',
          );
        if (why.length)
          blockers.push({ filaId: row.filaId, hoja: row.hoja, fila: row.fila, motivos: why });
      }
    }
    // Detecta duplicados dentro de la selección sin agruparlos automáticamente.
    for (const row of rows.filter(
      (r) => r.choice.servicio === 'NUEVO' && !r.choice.servicioDistinto,
    )) {
      if (
        rows.some(
          (other) =>
            Boolean(other.serviceKey) &&
            other.filaId !== row.filaId &&
            other.serviceKey !== row.serviceKey &&
            other.clientKey === row.clientKey &&
            other.productoId === row.productoId &&
            other.servidorId === row.servidorId &&
            other.fechaInicio === row.fechaInicio &&
            other.fechaFin === row.fechaFin,
        )
      )
        blockers.push({
          filaId: row.filaId,
          hoja: row.hoja,
          fila: row.fila,
          motivos: [
            'Posibles servicios duplicados en el lote. Agrupa las filas o confirma que son servicios distintos.',
          ],
        });
    }
    const cents = (mode: string) =>
      rows
        .filter((r) => r.choice.finanzas === mode)
        .reduce((sum, r) => sum + Math.round((r.importe ?? 0) * 100), 0) / 100;
    return {
      rows,
      clients: [...plannedClients.values()],
      blockers,
      report: {
        filas: rows.length,
        clientesNuevos: [...plannedClients.values()].filter((g) => g.crear).length,
        clientesExistentes: [...plannedClients.values()].filter((g) => !g.crear).length,
        referenciasNuevas: [...plannedClients.values()].filter((g) => !g.referenciaId).length,
        suscripcionesNuevas: [...services.keys()].filter((k) => k.startsWith('nuevo:')).length,
        operaciones: rows.filter((r) => r.choice.finanzas !== 'NINGUNA').length,
        ingresos: cents('COBRADO'),
        deuda: cents('DEUDA'),
        gratuitas: rows.filter((r) => r.choice.finanzas === 'GRATIS').length,
        pendientesFueraDelLote: c.review.rows.length - rows.length,
        estadoClienteNuevo: 'ACTIVO',
        fechaHistorica: 'FECHA menos un año; TOTAL no genera movimientos',
      },
    };
  }

  async propose(id: string, actor: string, dto: ProponerImportacionDto) {
    const hash = identityHash([id, actor, dto]);
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
          const previous = await tx.importacionLote.findUnique({
            where: { solicitudId: dto.solicitudId },
          });
          if (previous) {
            // JSONB puede reordenar las claves de la selección guardada. Una
            // reconstrucción equivalente debe recuperar también los lotes antiguos.
            if (
              previous.importacionId !== id ||
              previous.autor !== actor ||
              (previous.solicitudHash !== hash &&
                !isDeepStrictEqual(
                  selectionContent(previous.seleccion as unknown as ProponerImportacionDto),
                  selectionContent(dto),
                ))
            )
              throw new ConflictException('La solicitud ya se utilizó con otros datos.');
            return this.publicBatch(previous);
          }
          const c = await this.context(tx, id),
            plan = this.build(c, dto);
          const proposal = {
            resumen: plan.report,
            bloqueos: plan.blockers,
            clientes: plan.clients,
            filas: plan.rows.map((r) => ({
              filaId: r.filaId,
              hoja: r.hoja,
              fila: r.fila,
              nombre: r.nombre,
              servicio: r.choice.servicio,
              grupoId: r.choice.grupoId ?? null,
              servicioDistinto: r.choice.servicioDistinto,
              finanzas: r.choice.finanzas,
              tipoOperacion: r.choice.tipoOperacion ?? null,
              destino: r.serviceKey,
              producto: r.producto,
              tarifa: r.tarifa,
              servidor: r.servidor,
              referencia: r.referencia,
              metodoPago: r.metodoPago,
              fechaInicio: r.fechaInicio,
              fechaFin: r.fechaFin,
              importe: r.importe,
              historica: r.historica,
            })),
          };
          const b = await tx.importacionLote.create({
            data: {
              importacionId: id,
              autor: actor,
              solicitudId: dto.solicitudId,
              solicitudHash: hash,
              huella: c.huellaRevision,
              seleccion: json(dto),
              propuesta: json(proposal),
              motivo: dto.motivo,
            },
          });
          await audit(tx, actor, 'importaciones', id, 'PREPARAR_LOTE', null, {
            loteId: b.id,
            filas: plan.rows.length,
            bloqueos: plan.blockers.length,
          });
          return this.publicBatch(b);
        },
        { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .catch((error) => this.writeError(error));
  }

  async confirm(id: string, batchId: string, actor: string, dto: ConfirmarLoteDto) {
    if (dto.confirmar !== true) throw new BadRequestException('Confirma el lote revisado.');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await subscriptionLock(tx);
          for (const kind of [
            'productos',
            'tarifas',
            'servidores',
            'referencias',
            'metodos-pago',
          ] as const)
            await lockCatalog(tx, kind);
          await tx.$queryRaw`SELECT id FROM importaciones WHERE id=${id}::uuid FOR UPDATE`;
          const batch = await tx.importacionLote.findFirst({
            where: { id: batchId, importacionId: id, autor: actor },
          });
          if (!batch)
            throw new NotFoundException('Lote no encontrado o preparado por otro usuario.');
          if (batch.estado === 'APLICADO') return this.publicBatch(batch);
          await tx.$queryRaw`SELECT id FROM clientes ORDER BY id FOR UPDATE`;
          const c = await this.context(tx, id);
          const selection = batch.seleccion as unknown as ProponerImportacionDto;
          const plan = this.build(c, selection);
          if (plan.blockers.length)
            throw new ConflictException(
              'El lote contiene bloqueos. Resuélvelos y prepara una nueva propuesta.',
            );
          if (plan.rows.some((r) => r.choice.finanzas !== 'NINGUNA') && !dto.confirmarFinanzas)
            throw new BadRequestException('Este lote requiere confirmación financiera expresa.');
          const clientIds = new Map<string, string>();
          const groups = new Map(c.review.identidades.groups.map((g) => [g.id, g]));
          let newClients = 0,
            newRefs = 0,
            newSubscriptions = 0,
            newOperations = 0,
            newMovements = 0;
          for (const p of plan.clients) {
            const g = groups.get(p.identidadId)!;
            let client = p.clienteId
              ? await tx.cliente.findUniqueOrThrow({ where: { id: p.clienteId } })
              : null;
            if (!client) {
              const data = identityData(g.datos);
              client = await tx.cliente.create({
                data: {
                  ...data,
                  telefonoNormalizado: identityPhone(data.telefono),
                  estadoId: await stateId(tx, 'cliente', 'ACTIVO'),
                },
              });
              newClients++;
              await audit(tx, actor, 'clientes', client.id, 'IMPORTAR', null, {
                loteId: batch.id,
                identidadId: g.id,
              });
            }
            let refId = p.referenciaId;
            if (!refId) {
              const ref = await tx.referencia.create({ data: { nombre: p.referencia } });
              refId = ref.id;
              newRefs++;
              await audit(tx, actor, 'referencias', ref.id, 'IMPORTAR', null, {
                loteId: batch.id,
                clienteId: client.id,
              });
            }
            clientIds.set(p.clienteId ?? p.identidadId, client.id);
            const snapshot = {
              id: client.id,
              nombre: client.nombre,
              telefono: client.telefono,
              email: client.email,
              observaciones: client.observaciones,
              estadoId: client.estadoId,
              updatedAt: client.updatedAt,
              deletedAt: client.deletedAt,
            };
            for (const identityId of p.identidades) {
              const identity = groups.get(identityId)!;
              await tx.importacionIdentidad.update({
                where: { id: identity.id },
                data: {
                  estado: 'VINCULADO',
                  materializada: true,
                  clienteDestinoId: client.id,
                  huellaCliente: identityHash(snapshot),
                  historial: json([
                    ...(Array.isArray(identity.historial) ? identity.historial : []),
                    {
                      id: randomUUID(),
                      accion: 'MATERIALIZAR',
                      autor: actor,
                      fecha: new Date().toISOString(),
                      motivo: batch.motivo,
                      filas: plan.rows
                        .filter((r) => r.identidadId === identity.id)
                        .map((r) => r.filaId),
                      clienteId: client.id,
                      referenciaId: refId,
                      loteId: batch.id,
                    },
                  ]),
                },
              });
            }
          }
          const serviceIds = new Map<string, string>();
          const sorted = [...plan.rows].sort(
            (a, b) =>
              (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? '') ||
              a.filaId.localeCompare(b.filaId),
          );
          const output: Array<{
            filaId: string;
            clienteId: string;
            suscripcionId: string | null;
            renovacionId: string | null;
            movimientoId: string | null;
          }> = [];
          for (const row of sorted) {
            const clienteId = clientIds.get(row.clientKey)!;
            let subId: string | null = null,
              renewalId: string | null = null,
              movementId: string | null = null;
            if (row.serviceKey) {
              subId =
                serviceIds.get(row.serviceKey) ??
                (row.serviceKey.startsWith('nuevo:') ? null : row.serviceKey);
              let sub = subId
                ? await tx.suscripcion.findUniqueOrThrow({ where: { id: subId } })
                : null;
              const client = await tx.cliente.findUniqueOrThrow({
                where: { id: clienteId },
                include: { estado: true },
              });
              if (
                row.choice.servicio !== 'CONSERVAR' &&
                !row.historica &&
                client.estado.valor !== 'ACTIVO'
              )
                throw new ConflictException('Un servicio operativo requiere un cliente activo.');
              const estado = row.historica
                ? 'HISTORICA'
                : datedState(parseDay(row.fechaFin!), c.today, c.days);
              if (!sub) {
                sub = await tx.suscripcion.create({
                  data: {
                    clienteId,
                    productoId: row.productoId!,
                    tarifaId: row.tarifaId!,
                    servidorId: row.servidorId!,
                    referenciaId: row.referenciaId,
                    fechaInicio: parseDay(row.fechaInicio!),
                    fechaFin: parseDay(row.fechaFin!),
                    estadoId: await stateId(tx, 'suscripcion', estado),
                    tipoDispositivo: row.tipoDispositivo,
                    identificadorOperativoHash: row.identificadorOperativoHash,
                  },
                });
                subId = sub.id;
                newSubscriptions++;
                serviceIds.set(row.serviceKey, sub.id);
                await audit(tx, actor, 'suscripciones', sub.id, 'IMPORTAR', null, {
                  loteId: batch.id,
                  filaId: row.filaId,
                  estado,
                });
              } else if (row.choice.servicio !== 'CONSERVAR' && row.fechaFin! > day(sub.fechaFin)) {
                await tx.suscripcion.update({
                  where: { id: sub.id },
                  data: {
                    fechaInicio: parseDay(row.fechaInicio!),
                    fechaFin: parseDay(row.fechaFin!),
                    tarifaId: row.tarifaId!,
                    servidorId: row.servidorId!,
                    referenciaId: row.referenciaId,
                    estadoId: await stateId(tx, 'suscripcion', estado),
                    version: { increment: 1 },
                  },
                });
                await audit(tx, actor, 'suscripciones', sub.id, 'IMPORTAR_PERIODO', null, {
                  loteId: batch.id,
                  filaId: row.filaId,
                  fechaInicio: row.fechaInicio,
                  fechaFin: row.fechaFin,
                });
              }
              if (row.choice.finanzas !== 'NINGUNA') {
                const attribution = {
                  atribucionVerificada: true,
                  productoIdSnapshot: row.productoId,
                  servidorIdSnapshot: row.servidorId,
                  referenciaIdSnapshot: row.referenciaId,
                  productoNombreSnapshot: row.producto,
                  tarifaNombreSnapshot: row.tarifa,
                  servidorNombreSnapshot: row.servidor,
                  referenciaNombreSnapshot: row.referencia,
                  metodoPagoNombreSnapshot: row.metodoPago,
                };
                const renewal = await tx.renovacion.create({
                  data: {
                    ...attribution,
                    suscripcionId: sub.id,
                    tipoOperacion: row.choice.tipoOperacion!,
                    fechaInicio: parseDay(row.fechaInicio!),
                    fechaFin: parseDay(row.fechaFin!),
                    fechaOperacion: parseDay(row.fechaInicio!),
                    importe: row.importe!,
                    metodoPagoId: row.metodoPagoId!,
                    estadoId: await stateId(tx, 'renovacion', 'COMPLETADA'),
                    origen: 'IMPORTACION_EXCEL',
                    observaciones: batch.motivo,
                  },
                });
                renewalId = renewal.id;
                newOperations++;
                await audit(tx, actor, 'renovaciones', renewal.id, 'IMPORTAR', null, {
                  loteId: batch.id,
                  filaId: row.filaId,
                });
                if (row.choice.finanzas !== 'GRATIS') {
                  const paid = row.choice.finanzas === 'COBRADO';
                  const movement = await tx.movimientoFinanciero.create({
                    data: {
                      ...attribution,
                      tipoId: await stateId(tx, 'movimiento_tipo', 'INGRESO'),
                      estadoId: await stateId(
                        tx,
                        'movimiento_estado',
                        paid ? 'CONFIRMADO' : 'PENDIENTE',
                      ),
                      suscripcionId: sub.id,
                      renovacionId: renewal.id,
                      operacionClave: renewal.id,
                      metodoPagoId: row.metodoPagoId!,
                      importe: row.importe!,
                      fecha: parseDay(row.fechaInicio!),
                      fechaCobro: paid ? parseDay(row.fechaInicio!) : null,
                      fechaPrevistaCobro: paid ? null : parseDay(row.fechaInicio!),
                      origen: 'IMPORTACION_EXCEL',
                      descripcion: batch.motivo,
                    },
                  });
                  movementId = movement.id;
                  newMovements++;
                  await audit(tx, actor, 'movimientos_financieros', movement.id, 'IMPORTAR', null, {
                    loteId: batch.id,
                    filaId: row.filaId,
                    estado: paid ? 'CONFIRMADO' : 'PENDIENTE',
                  });
                }
              }
            }
            const previous = c.review.lecturas.find((r) => r.id === row.filaId)!;
            const links = {
              clienteId,
              suscripcionId: subId ?? previous.suscripcionId,
              renovacionId: renewalId ?? previous.renovacionId,
              movimientoId: movementId ?? previous.movimientoId,
            };
            await tx.importacionFila.update({
              where: { id: row.filaId },
              data: {
                ...links,
                version: { increment: 1 },
                ...(subId
                  ? {
                      mapeo: json({
                        productoId: row.productoId,
                        tarifaId: row.tarifaId,
                        servidorId: row.servidorId,
                        referenciaId: row.referenciaId,
                        fechaInicio: row.fechaInicio,
                        fechaFin: row.fechaFin,
                        metodoPagoId: row.metodoPagoId,
                        loteId: batch.id,
                      }),
                    }
                  : {}),
              },
            });
            output.push({ filaId: row.filaId, ...links });
          }
          await tx.importacion.update({
            where: { id },
            data: { versionIdentidades: { increment: 1 } },
          });
          const result = {
            clientesNuevos: newClients,
            referenciasNuevas: newRefs,
            suscripcionesNuevas: newSubscriptions,
            operaciones: newOperations,
            movimientos: newMovements,
            filas: output,
          };
          await audit(tx, actor, 'importaciones', id, 'APLICAR_LOTE', null, {
            loteId: batch.id,
            ...result,
          });
          return this.publicBatch(
            await tx.importacionLote.update({
              where: { id: batch.id },
              data: { estado: 'APLICADO', aplicadoAt: new Date(), resultado: json(result) },
            }),
          );
        },
        { timeout: 60000 },
      );
    } catch (error) {
      await this.prisma.importacionLote.updateMany({
        where: { id: batchId, importacionId: id, autor: actor, estado: { not: 'APLICADO' } },
        data: { estado: 'FALLIDO' },
      });
      return this.writeError(error);
    }
  }

  private writeError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2034'].includes(error.code)
    )
      throw new ConflictException(
        'Otro proceso ha cambiado los datos o existe un duplicado. Actualiza la propuesta.',
      );
    throw error;
  }
}

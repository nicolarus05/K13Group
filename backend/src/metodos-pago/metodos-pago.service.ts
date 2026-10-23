import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrderDto } from '../configuracion/configuracion.dto';
import { revision, bumpRevision } from '../configuracion/settings';
import { lockCatalog, CatalogService } from '../catalogos/catalogos.service';

@Injectable()
export class MetodosPagoService extends CatalogService {
  constructor(prisma: PrismaService) {
    super(prisma, 'metodos-pago');
  }
  order() {
    return this.prisma.$transaction(
      async (tx) => ({
        version: await revision(tx, 'metodos_pago.revision'),
        data: await tx.metodoPago.findMany({
          orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        }),
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  reorder(dto: OrderDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockCatalog(tx, 'metodos-pago');
      const version = await revision(tx, 'metodos_pago.revision');
      if (version !== dto.version)
        throw new ConflictException('El catálogo ha cambiado. Recarga el orden.');
      const rows = await tx.metodoPago.findMany({
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
      });
      if (dto.ids.length !== rows.length || rows.some((r) => !dto.ids.includes(r.id)))
        throw new BadRequestException('Incluye todos los métodos exactamente una vez.');
      for (const [i, id] of dto.ids.entries())
        await tx.metodoPago.update({ where: { id }, data: { orden: i + 1 } });
      await bumpRevision(tx, version + 1, 'metodos_pago.revision');
      await tx.actividad.create({
        data: {
          usuarioId: actor,
          tabla: 'metodos_pago',
          accion: 'ORDENAR',
          datosAnteriores: { ids: rows.map((r) => r.id) },
          datosNuevos: { ids: dto.ids, motivo: dto.motivo },
        },
      });
      return { version: version + 1 };
    });
  }
}

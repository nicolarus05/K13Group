import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CatalogService } from '../catalogos/catalogos.service';

@Injectable()
export class ReferenciasService extends CatalogService {
  constructor(prisma: PrismaService) {
    super(prisma, 'referencias');
  }
  async summary(id: string) {
    await this.findOne(id);
    const rows = await this.prisma.suscripcion.groupBy({
      by: ['clienteId'],
      where: { referenciaId: id, deletedAt: null, cliente: { deletedAt: null } },
    });
    return {
      clientes: rows.length,
      criterio:
        'Clientes únicos con suscripciones no eliminadas vinculadas actualmente a esta referencia.',
    };
  }
}

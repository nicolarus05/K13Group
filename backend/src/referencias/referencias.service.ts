import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CatalogService } from '../catalogos/catalogos.service';

@Injectable()
export class ReferenciasService extends CatalogService {
  constructor(prisma: PrismaService) {
    super(prisma, 'referencias');
  }
}

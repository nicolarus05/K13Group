import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ServidoresService {
  constructor(private readonly prisma: PrismaService) {}
}

import { Module } from '@nestjs/common';
import { CategoriasGastoController } from './categorias-gasto.controller';
import { CategoriasGastoService } from './categorias-gasto.service';
@Module({
  controllers: [CategoriasGastoController],
  providers: [CategoriasGastoService],
  exports: [CategoriasGastoService],
})
export class CategoriasGastoModule {}

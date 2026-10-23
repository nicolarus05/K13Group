import { Module } from '@nestjs/common';
import { RecoveryController, RecoveryStatusController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
@Module({
  controllers: [RecoveryController, RecoveryStatusController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}

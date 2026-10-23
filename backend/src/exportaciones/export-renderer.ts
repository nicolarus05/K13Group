import { Worker } from 'node:worker_threads';
import { BadRequestException } from '@nestjs/common';
import { ExportDocument, MAX_BYTES } from './export-document';

export async function renderInWorker(data: ExportDocument, format: 'xlsx' | 'csv' | 'pdf') {
  return new Promise<Buffer>((resolve, reject) => {
    const worker = new Worker(
      `
      const {parentPort,workerData}=require('node:worker_threads');
      require(workerData.module).renderDocument(workerData.data, workerData.format)
        .then(buffer=>parentPort.postMessage({buffer}))
        .catch(()=>parentPort.postMessage({error:true}));
    `,
      {
        eval: true,
        workerData: { module: require.resolve('./export-document'), data, format },
        execArgv: __filename.endsWith('.ts') ? ['-r', 'ts-node/register'] : [],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    const fail = () =>
      reject(
        new BadRequestException(
          'No se pudo generar el archivo dentro de los límites. Acota los filtros y reintenta.',
        ),
      );
    const timer = setTimeout(() => {
      void worker.terminate();
      fail();
    }, 20000);
    worker.once('message', (result: { buffer?: Uint8Array; error?: boolean }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!result.buffer || result.buffer.length > MAX_BYTES) fail();
      else resolve(Buffer.from(result.buffer));
    });
    worker.once('error', () => {
      clearTimeout(timer);
      fail();
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      fail();
    });
  });
}

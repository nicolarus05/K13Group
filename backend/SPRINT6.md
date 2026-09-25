# Sprint 6 — Renovaciones, primer pago y cobros

Implementado el 24/09/2026. No importa el XLSX ni crea cobros históricos.

## Reglas confirmadas

- Siempre 12 meses. Anticipada desde el vencimiento; tardía desde el día de renovación.
- Renovar el 25 y cobrar el 30 mantiene vencimiento el 25 del año siguiente.
- Operación de servicio COMPLETADA independiente del movimiento PENDIENTE/CONFIRMADO.
- Primer pago ALTA explícito sin añadir otro año. El alta de cliente/suscripción
  sigue sin crear ingresos ni asumir que ya se ha cobrado.
- Gratis por esGratuito: cero euros y sin movimiento ni deuda.
- Precio propuesto por tarifa; importe diferente exige motivo.
- Método previsto al aplazar; método monetario real y fecha al cobrar. Pago completo,
  no pagos fraccionados. Cobrar una deuda de servicio cancelado no lo reactiva.
- No renovar es reversible por suscripción y no equivale a cancelación definitiva.

## Operación y límites

/renovaciones ofrece seguimiento (hoy/mañana/próximas/vencidas/No renovar/todas)
e historial con filtros y paginación. /renovaciones/:id muestra el detalle.
Accesible desde cliente/suscripción; botones de primer pago, renovación, cobro,
anulación y preferencia. Snapshots históricos conservados.

Todas las rutas requieren JWT. Contratos completos en el modelo de API REST.
Importe por API como cadena decimal; fechas YYYY-MM-DD; versión y solicitudId en
altas/renovaciones. Repetir una solicitud idéntica es idempotente, otra carga con
esa clave da 409. Cobros/anulaciones también toleran repeticiones sin efectos nuevos.

Renovación, ingreso/deuda, fechas, avisos y auditoría son una única transacción.
Concurrencia coordinada con suscripciones y catálogos. GET no sincroniza estados
ni espera al worker. El formulario conserva borrador/versión ante respuestas
tardías y errores, y la clave en reintentos. Cancelar no escribe.

Anulación solo para última operación GESTION_WEB compatible con periodo anterior
conocido. Rechaza operaciones posteriores, históricos y reapertura de canceladas.
Restaura fechas preservando suspensión; anula movimiento y conserva datos/auditoría.
No ejecuta reembolso bancario. Tras anular se puede registrar la corrección.

Avisos RENOVACION por periodo y COBRO por deuda, revisión al inicio y cada minuto.
Lotes de 100 con progreso confirmado, claves únicas solo en avisos abiertos.
Renovar/cobrar completa; suspender/cancelar/No renovar retira avisos de renovación,
sin perdonar deuda. Los terminales no se reabren, se crea otro cuando corresponda.
Los avisos se reflejan operativamente en seguimiento y listado de cobros; agenda,
posponer y envíos externos pertenecen al sprint 10.

## Migración local

20260924150000_renovaciones_cobros: preferencia, versiones/claves de operaciones,
periodo anterior/anulación, fecha real/prevista de cobro y claves de avisos.
Adiciones compatibles con históricos. Clasifica ALTA por origen existente,
sin modificar importes ni periodos ni crear ingresos.

Desde backend:

    npx prisma migrate deploy
    npx prisma generate

En Docker, desde la raíz:

    docker-compose exec -T backend npx prisma generate
    docker-compose up -d --force-recreate backend

No ejecutar seed histórico, migración de alias ni importador.

Migración aplicada en el entorno local y cliente Prisma regenerado tanto en
host como en Docker. Backend reiniciado: Swagger 200, renovaciones sin sesión 401.
Recuentos de negocio locales conservados; cero esquemas temporales pendientes.

## Pruebas reproducibles

Desde backend:

    npm test -- --runInBand
    npm run test:integration
    SUBSCRIPTIONS_LOAD_TEST=1 npm run test:integration
    npm run test:e2e:renovaciones
    npm run type-check
    npm run lint

Compilar backend a una carpeta temporal para no interferir con Docker:

    build_dir=$(mktemp -d /tmp/k13-sprint6-build.XXXXXX)
    npx tsc -p tsconfig.build.json --outDir "$build_dir" --incremental false

Desde frontend:

    npm run build
    npm run test:ui

Integración crea/migra un esquema catalogos_test_<uuid> por suite y lo elimina al terminar.
La carga opcional se ejecuta primero y en su propio esquema, sin dejar fixtures
para las suites de catálogos, suscripciones ni avisos. Se descubren automáticamente
todos los archivos .integration.spec.ts.
El runner fuerza NODE_ENV=test; no arranca workers de producción en las suites.
No apuntar los runners a producción.

UI necesita frontend arrancado y Chrome. Variables opcionales CHROME_PATH y
FRONTEND_TEST_URL. Las pruebas UI simulan API; E2E usa Nest real en puerto temporal
y redirige exclusivamente su navegador al PostgreSQL aislado, con usuario ficticio.
Ni el navegador ni los fixtures de prueba escriben en la base local real.

Resultados de validación (revisión del 25/09/2026):

- 61 pruebas normales de integración: 19 catálogos + 19 suscripciones + 23 sprint 6.
- 1 regresión opcional de carga superada: 10.000 suscripciones; consulta concurrente
  1.043 ms, procesamiento 37,7 s en este entorno, sin timeout por transacción.
  Las 61 pruebas normales pasan a continuación en la misma ejecución del runner.
- 10 pruebas unitarias existentes de fechas/parser.
- 11 pruebas de Chrome con API simulada, incluida edición tras renovación anticipada.
- E2E real: primer pago, renovación pendiente, cobro, anulación y filtro;
  renovación anticipada y edición operativa sin alterar el periodo futuro.
  Tres operaciones/tres movimientos conservados, cero importaciones y errores JS.
- Concurrencia real de renombrado de cliente y renovación, con intercalado controlado:
  ambas operaciones terminan, sin deadlock, con una referencia y una renovación.
- Fechas futuras persistidas por renovación son de solo lectura en el formulario;
  no impiden editar dispositivo/servidor. Las altas futuras siguen rechazadas y
  no se permite corregir manualmente el periodo de una suscripción ya renovada.
- Fallo de auditoría revierte fechas, renovación, movimiento y avisos.
- Fallo en segundo lote de avisos conserva los 100 primeros y reintenta hasta
  203 sin duplicarlos. Dos workers concurrentes no duplican avisos.
- Tipos y compilación de backend/frontend correctos. Lint sin errores;
  siete advertencias previas de imports no usados en módulos fuera del sprint.

Correcciones de revisión: clientes adquiere el bloqueo de referencias antes de
escribir su fila, respetando el orden de suscripciones/renovaciones. El formulario
no aplica el límite de fecha de alta a periodos futuros ya renovados. El aislamiento
por suite elimina los timeouts de avisos causados por fixtures de carga compartidos.

## Pendiente en otros sprints

Finanzas completas (gastos, balances, informes) en sprint 7. Dashboard/estadísticas,
pagos fraccionados, cobros externos, correcciones históricas complejas, renovaciones
masivas y calendario/envíos no incluidos. La importación del sprint 3.5 continúa
aplazada hasta recibir el Excel corregido. Este trabajo no hace commit ni push.

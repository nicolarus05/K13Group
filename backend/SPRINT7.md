# Sprint 7 — Finanzas

Implementado el 25/09/2026. No importa el XLSX ni genera movimientos históricos.

## Decisiones confirmadas

- Solo gastos ya pagados, generales, en euros. No se registran gastos pendientes.
- Sin asociación a productos/servidores; se podrá añadir en otro sprint.
- Ingreso bruto: 75 € cobrados se muestran como 75 €. Sin comisiones automáticas.
- Resultado operativo = ingresos confirmados menos gastos confirmados registrados;
  no es un beneficio fiscal ni incluye costes que no se hayan registrado.

## Funcionalidad

`/finanzas` ofrece libro paginado y balance. Filtros: fechas, tipo, estado,
categoría, método, cliente y concepto/descripción/observaciones. Rangos: hoy,
semana lunes–domingo, mes, trimestre, año, todo el histórico y personalizado.
`/finanzas/:id` muestra detalle, snapshots, historial y enlaces a cliente,
suscripción y renovación. Los ingresos no se editan ni se crean desde Finanzas.

Gastos: concepto, categoría, fecha real de pago, importe, método y observaciones.
Alta confirmada, edición con motivo/versión y anulación terminal con motivo.
Sin borrado físico. Métodos Gratis, importe cero/negativo, fechas futuras,
campos adicionales y catálogos nuevos inactivos se rechazan. Una categoría o
método históricos desactivados pueden conservarse al editar; sus snapshots
no se reemplazan por los nombres actuales.

Al cobrar/anular un ingreso se reutiliza el proceso del sprint 6. Las consultas
de Finanzas se invalidan tras estas acciones. No se modifican los periodos
contratados al cobrar ni se duplican movimientos. La anulación de ingresos sigue
sujeta a todas las restricciones de renovaciones, también para históricos.

## Consistencia y balances

- Mutación y auditoría dentro de la misma transacción.
- Bloqueos de gastos, categoría y método en orden fijo; gastos no toman filas
  de clientes/suscripciones ni sus bloqueos de negocio.
- Alta idempotente con operacionClave y hash de solicitud/usuario. Repetir la
  clave con otra carga da 409. Edición por versión; anulación idéntica tolera reintento.
- Formularios conservan borrador, versión e identificador de reintento ante error.
- Balance agregado por PostgreSQL/Decimal, devuelto como cadenas de dos decimales.
  Las consultas de listado/recuento y agregados usan snapshots RepeatableRead.
- Ingresos y gastos solo CONFIRMADO. PENDIENTE es deuda por cobrar separada;
  ANULADO no suma. Operaciones = número de ingresos/gastos confirmados.
  Ticket medio = ingresos confirmados / número de ingresos confirmados (cero si vacío).
- Todos los filtros, incluido estado/tipo, afectan al libro y al balance.
  Un filtro solo ANULADO muestra los registros, pero resultado cero.
- Fecha financiera = fechaCobro o, si falta, fecha original. Los pendientes
  se filtran por registro de deuda, no por plazo previsto. Hasta es inclusivo.
  No inventar fecha de cobro ni nombres históricos ausentes.
- No se guardan balances ni acumulados financieros de clientes.

## API

Todas bajo `/api/v1/finanzas` y protegidas con JWT:

- GET `/`, `/balance`, `/:id`, `/:id/historial`.
- POST `/gasto`: solicitudId y campos completos del gasto.
- PUT `/:id`: campos completos, versión y motivo.
- POST `/:id/anular`: versión y motivo.

No existe POST `/ingreso`. Los contratos y límites están en el modelo de API REST.
Paginación limitada a 100; selecciones explícitas sin credenciales de dispositivos
ni hashes internos en la respuesta del movimiento. Consultas no realizan escrituras.

## Migración y entorno local

`20260925100000_finanzas_gastos` añade campos de gasto, versión, idempotencia,
anulación y timestamp de actualización en movimientos_financieros, con índices.
No cambia importes, fechas ni relaciones históricas. Campos nuevos opcionales
compatibles con el importador y con movimientos del sprint 6.

Desde backend:

    npx prisma migrate deploy
    npx prisma generate

En Docker, desde la raíz:

    docker-compose exec -T backend npx prisma generate
    docker-compose restart backend

No ejecutar seed histórico ni importador. Migración aplicada en local, cliente
regenerado en host y contenedor. No se crean gastos ficticios en el esquema public.
Verificado tras las pruebas: 2 clientes, 0 suscripciones, 0 renovaciones,
0 movimientos y 0 importaciones, igual que antes. Sin esquemas temporales pendientes.
API local autenticada: listado y balance 200, vacío/0,00; sin sesión devuelve 401.

## Pruebas reproducibles

Desde backend:

    npm run test:integration
    SUBSCRIPTIONS_LOAD_TEST=1 npm run test:integration
    npm test -- --runInBand --testPathIgnorePatterns=integration.spec.ts
    npm run test:e2e:finanzas
    npm run test:e2e:renovaciones
    npx tsc --noEmit --incremental false
    npm run lint

Desde frontend (Chrome y frontend arrancado para UI/E2E):

    npm run build
    npm run test:ui

Cada suite de integración crea/migra/elimina su propio esquema catalogos_test_UUID.
Los E2E redirigen únicamente su navegador a Nest temporal con Prisma aislado.
No ejecutar estos runners en producción. FRONTEND_TEST_URL/CHROME_PATH opcionales.

Validación:

- 78 pruebas normales de integración: 19 catálogos, 19 suscripciones,
  23 renovaciones y 17 finanzas, incluidas las regresiones de revisión.
- Suite opcional de carga superada en la validación inicial del sprint. Procesamiento
  de 10.000 suscripciones en 44 s y lectura concurrente en 968 ms en este entorno;
  los fixtures no contaminan las pruebas posteriores de avisos/finanzas.
- Finanzas incluye carga de 10.000 movimientos, agregación exacta y respuesta
  paginada; no deja auditorías al leer ni carga todo el libro en el navegador.
- Cobro real del 1 de octubre de una operación de septiembre: ingreso en octubre,
  bruto de 75 €, mismo movimiento y mismas fechas de servicio. Anular lo excluye.
- Fallo forzado de auditoría revierte alta, edición y anulación de gastos.
- Doble alta/reintento: un gasto; doble edición: un éxito y un conflicto;
  doble anulación idéntica: una sola transición/auditoría.
- 10 pruebas unitarias existentes y 17 pruebas Chrome con API simulada (6 nuevas).
- E2E Finanzas real: deuda → cobro → gasto → edición → anulación → filtro.
  Resultado 75 → 49,90 → 55 → 75 €, dos movimientos conservados, cero importaciones.
  Ampliado con anulación del ingreso: el motivo aparece en su ficha financiera
  aunque el campo del movimiento sea nulo, y el balance de ingresos queda a cero.
- E2E del sprint 6 repetido con éxito: primer pago, renovación pendiente, cobro,
  anulación, filtro y edición tras renovación anticipada. Sin errores JavaScript.
- Compilación/tipos correctos. Lint sin errores; seis advertencias previas de
  imports sin usar en módulos pendientes, fuera del alcance del sprint.

## Correcciones de revisión

- Finanzas resuelve el motivo/fecha de anulación de un ingreso desde su renovación
  anulada cuando faltan en el movimiento. También cubre operaciones anteriores,
  sin migración ni backfill y sin alterar el libro o añadir auditorías al consultar.
- El listado ordena por COALESCE(fecha_cobro, fecha) descendente e id descendente
  como desempate, antes de LIMIT/OFFSET. Solo se cargan los detalles de la página.
- Listado, recuento y balance comparten un único filtro SQL parametrizado para
  mantener fechas, búsquedas y catálogos coherentes. Pruebas de páginas con fechas
  cruzadas/empatadas, filtros combinados y búsquedas con comillas.

## Fuera de alcance

Importación XLSX, gastos pendientes/recurrentes, impuestos, facturación,
conciliación bancaria, pagos parciales, cierres contables, reembolsos reales,
rentabilidad por producto/servidor y exportaciones. Dashboard general en sprint 8;
gráficas y comparativas avanzadas en sprint 9. Sin commit ni push en esta entrega.

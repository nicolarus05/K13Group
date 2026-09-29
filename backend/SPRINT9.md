# Sprint 9 — Estadísticas

Implementación del 28/09/2026, revisada y validada el 29/09/2026 para su cierre.
Sin importación del XLSX.

## Entrega y reglas

Ocho informes autenticados en `/estadisticas`: Resumen, Clientes, Renovaciones,
Finanzas, Productos, Servidores, Referencias y Métodos de pago. Estilo K13 del
dashboard, navegación responsive, filtros por sección, gráficos con tablas
accesibles de valores exactos, rankings paginados y top 10 + Otros.

- Ingresos brutos y gastos exclusivamente CONFIRMADO por `fechaCobro ?? fecha`;
  pendientes/anulados no suman. Resultado operativo, no beneficio fiscal.
  Ticket medio = ingresos / movimientos de ingreso confirmados.
- Serie de ingresos, gastos y resultado; altas de clientes y renovaciones por
  día/mes/año. Comparación financiera y de altas contra ventana anterior contigua
  de igual número de días; porcentaje null cuando la base anterior es cero.
- Clientes actuales únicos, con servicio, con algún No renovar y perdidos.
  Perdido: tiene suscripciones y han pasado al menos 30 días desde su último
  vencimiento, sin otro servicio vigente. Nunca confundir con una nueva alta sin
  suscripciones. El estado actual filtra solo indicadores actuales.
- Tasa por CLIENTE: clientes únicos que renovaron al menos una suscripción con
  vencimiento en el intervalo / clientes únicos con vencimiento en el intervalo.
  Tres servicios de un cliente cuentan una sola persona. Renovar dos de tres
  cuenta una persona renovada, no 66,7 %. Una alta inicial no es renovación.
- Cohortes por vencimiento original (`finAnterior`), no fecha de pago ni de
  operación. Anticipadas/tardías, gratuitas y con cobro pendiente cuentan;
  anuladas no. La tasa refleja la evidencia disponible al consultar y puede
  cambiar al registrar renovaciones tardías. Cero clientes => null, no 0 %.
- Si existe una renovación completada sin vencimiento anterior verificable,
  se avisa de cobertura incompleta y se deja la tasa definitiva a null. La API
  ofrece el porcentaje observable y el número de registros incompletos. Esta
  comprobación es global y conservadora: no se puede asignar a una cohorte un
  vencimiento desconocido. No se deduce restando un año a la nueva fecha.
- Rankings por IDs canónicos congelados. Cambiar servidor/referente después
  de registrar la operación no traslada sus ingresos, tampoco al cobrar tarde.
  Nombres actuales del catálogo con fallback al snapshot, incluidos inactivos.
  Sin referencia conocido y atribución desconocida son grupos diferentes.
- Clientes actuales por grupo se calculan sobre la configuración actual y se
  etiquetan aparte del dinero histórico. Un cliente puede aparecer en varios
  grupos: sus recuentos no son sumables. Gastos generales, sin repartir costes
  ni inventar rentabilidad por producto, servidor o referente.
- En Finanzas, método filtra solo ingresos; categoría solo gastos. Son
  mutuamente excluyentes. El resultado es no aplicable con estas bases parciales.

## API y persistencia

GET `/api/v1/estadisticas` o `/api/v1/estadisticas/resumen` y GET
`/api/v1/estadisticas/{clientes,renovaciones,finanzas,productos,servidores,referencias,metodos-pago}`.
Envoltorio success/data; JWT obligatorio, ninguna escritura al consultar.

Query común: desde/hasta (ambas YYYY-MM-DD inclusivas o ninguna: mes hasta hoy),
agrupacion=dia|mes|ano (mes por defecto), page>=1, limit=1..100 (10 por defecto).
Máximo cinco años; diario hasta 366 días. Día civil Europe/Madrid. Fechas de
suscripciones/cobros son DATE; altas createdAt se convierten de UTC a Madrid.
Comparaciones de periodos parciales NO equivalen necesariamente al mes calendario
anterior completo. Presets semana/mes/trimestre/año hasta hoy y últimos doce
meses desde el inicio del mes de hace once meses hasta hoy.

Filtros permitidos:
- Clientes: estadoCliente=ACTIVO|INACTIVO (situación actual).
- Renovaciones: estadoOperacion=COMPLETADA|ANULADA (operaciones, no cohorte).
- Productos/Servidores/Referencias: productoId, servidorId, referenciaId UUID.
- Métodos: metodoPagoId UUID. Finanzas: metodoPagoId O categoriaGastoId UUID.
- Resumen: sin filtros de entidad para no mezclar denominadores incompatibles.
Los filtros incompatibles, fechas inválidas y secciones desconocidas devuelven 400.

Todos los agregados de un informe comparten transacción RepeatableRead y día
de negocio. SQL parametrizado, Decimal y agregación en PostgreSQL; sin descargar
registros individuales para calcular totales. Listas acotadas y paginación estable.
Refresco cada minuto, invalidación tras mutaciones y rango relativo actualizado
al cambiar el día/foco; fechas personalizadas y borradores se conservan. Filtros,
sección y periodo persisten en sessionStorage, no en BD.

Migración `20260928100000_estadisticas_atribucion`: agrega en renovaciones y
movimientos atribucion_verificada=false y producto/servidor/referencia_id_snapshot
UUID nullable; índices fin_anterior y fecha_operacion. No altera dinero, fechas,
registros ni catálogos existentes. Nuevas operaciones web y futuras conciliaciones
del importador guardan esos IDs en la transacción original. No se importa nada.
Históricos sin evidencia quedan como «Sin atribución verificable»: sus ingresos
siguen incluidos en totales. No hay tablas de métricas ni backfill especulativo.

## Verificación reproducible

Backend (PostgreSQL local; ejecutar suites con BD secuencialmente):

```sh
npx prisma generate
npx tsc --noEmit --incremental false
npm run lint
npm test -- --runInBand --testPathIgnorePatterns=integration.spec.ts
npm run test:integration
npm run test:e2e:estadisticas
npm run test:e2e:dashboard
npm run test:e2e:finanzas
npm run test:e2e:renovaciones
```

Frontend (Chrome y frontend local disponibles):

```sh
npm run type-check
npm run lint
npm run build
npm run test:ui
```

Integración y E2E crean esquemas PostgreSQL temporales y los eliminan al terminar.
UI intercepta API sin escrituras de negocio. E2E cruza Dashboard, gastos, deudas,
cobro y ocho informes: ingresos 75 €, gastos 25,10 €, resultado 49,90 €.
Pruebas incluyen cliente multiservicio, renovaciones anticipadas, gratuitas,
pendientes/anuladas, pérdida a 30 días, zona horaria, histórico incompleto,
atribución antes/después de cobrar, Decimal, top 10 + Otros, 10.000 movimientos,
JWT, ausencia de escrituras/secretos, rangos, filtros, móvil y recuperación de errores.

## Límites explícitos

No XLSX real, exportaciones (sprint 12), calendario/envíos (10), metas,
predicciones, heatmaps, comisiones automáticas ni fiscalidad. No se reconstruye
una serie histórica de estados activos/perdidos: los datos actuales no permiten
afirmarla. La tasa por cohortes no inventa una segunda tasa de retención.
No hay repartos de gastos generales. No cambia el diseño del resto de módulos.

## Resultado de la verificación — 28/09/2026

- 18 pruebas unitarias, 99 de integración y 42 de interfaz aprobadas.
- Cuatro E2E aprobados: Estadísticas, Dashboard, Finanzas y Renovaciones.
- Tipos y compilación frontend correctos; backend compilado en Docker, que es
  propietario de los artefactos dist compartidos. Para repetir esa compilación:
  `docker-compose exec -T backend npm run build` desde la raíz del proyecto.
- Lint frontend sin advertencias. Backend sin errores, con cuatro advertencias
  previas de imports sin usar en módulos pendientes.
- Migración aplicada localmente y cliente Prisma regenerado también en Docker.
  Los ocho endpoints responden 200 con sesión y rechazan consultas sin sesión.
- Datos locales antes/después: dos clientes, cero suscripciones, renovaciones,
  movimientos e importaciones. No se ha cargado XLSX ni creado un commit.
- Corregido durante la revisión: al reducirse un ranking se reajusta la página
  y se consulta de nuevo, evitando reutilizar una página antigua aún fresca en
  caché. Etiquetas de filtros accesibles y primer alta diferenciada de pago.

Los esquemas temporales de las pruebas se eliminan al finalizar; sus datos son
ficticios y reproducibles. Las capturas de revisión están en
`/tmp/k13-estadisticas-desktop.png` y `/tmp/k13-estadisticas-mobile.png`.

## Corrección tras revisión — 29/09/2026

Los desplegables de Estadísticas ahora comparten el prefijo de caché `catalogos`.
Al crear, editar, desactivar o reactivar un catálogo, su invalidación existente
alcanza también las opciones de los informes, incluidas búsquedas y páginas
almacenadas que no estén montadas. No se duplican los flujos de guardado.

El botón Actualizar consulta de nuevo tanto el informe como los catálogos activos,
sin reiniciar la búsqueda, la página ni la selección; las opciones inactivas
siguen disponibles para consultar su histórico.

Se añaden seis pruebas de regresión en navegador: los cuatro cambios de catálogo
en productos, servidores, referencias, métodos de pago y categorías de gasto;
y el refresco manual con búsqueda, segunda página y selección conservadas.
Las pruebas de cambios congelan Date para que la caducidad de la caché no oculte
el fallo. La de alta de producto se comprobó fallando antes de aplicar la corrección.
Todas las escrituras de estas pruebas se interceptan: no modifican datos reales.

Verificación posterior: 48 pruebas de interfaz aprobadas (seis nuevas), los
cuatro E2E de Estadísticas/Dashboard/Finanzas/Renovaciones aprobados, tipos y
compilación frontend correctos y lint frontend sin errores ni advertencias.
No se modifica backend ni esquema de datos para esta corrección.

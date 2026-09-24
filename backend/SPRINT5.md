# Sprint 5 — Suscripciones

Implementado el 23/09/2026 y corregido/validado el 24/09/2026 tras la revisión.
No requiere ni ejecuta la importación del XLSX.

## Funcionalidad

- /suscripciones: listado paginado, búsqueda y filtros por cliente, producto,
  servidor, referencia y estado; orden por vencimiento o creación.
- /suscripciones/nueva: alta anual, también desde la ficha del cliente.
- /suscripciones/:id: detalle, edición, historial y acciones con confirmación.
- Suspender, reactivar y cancelar requieren motivo. Reactivar no amplía fechas.
  Cancelar es definitivo; no existe borrado físico ni reactivación de canceladas.
- Cliente y producto son inmutables. Cambiar tarifa, servidor o referencia no
  reescribe renovaciones ni sus snapshots. Se conservan catálogos históricos inactivos.
- Corregir inicio requiere motivo y ausencia de renovaciones; el fin se recalcula
  a un año. No se permiten fechas futuras ni editar directamente el vencimiento.

La API requiere sesión JWT. Solicitudes de alta llevan solicitudId UUID persistente
por intento lógico: repetir usuario/datos/clave devuelve la suscripción existente,
sin duplicarla; reutilizar con otro contenido produce 409. Las ediciones y acciones
requieren version; si otro proceso cambió el registro, se devuelve 409 y hay que
recargar. El formulario mantiene la clave para reintentos de los mismos datos.

## Fechas y automatización

El periodo es anual; el 29 de febrero se ajusta al 28 de febrero siguiente cuando
corresponde. Las columnas son días SQL, y el día de negocio usa Europe/Madrid.

- Fin hoy o anterior: VENCIDA.
- Entre 1 y 7 días restantes: PROXIMA_A_VENCER.
- Más días: ACTIVA.

La clave de configuración suscripciones.dias_proxima acepta enteros 1–365, con
valor por defecto 7. No necesita seed nuevo ni lectura del Excel.
El backend revisa al arrancar y cada minuto, confirmando lotes de hasta 100 registros.
Si un lote falla, el siguiente intento conserva los anteriores y retoma pendientes.
Las lecturas (incluida la ficha de cliente y el historial) no escriben ni esperan al
worker. El listado y sus filtros calculan el estado efectivo por fecha, manteniendo
la versión persistida. Cada edición/acción valida esa versión y sincroniza solo
su registro dentro de su propia transacción. Si está apagado, el backend recupera
los estados al arrancar. No ejecuta bloqueos en servidores externos.
Las transiciones automáticas preservan SUSPENDIDA, CANCELADA y BORRADOR.
Esta última no está disponible en el alta manual.

El servicio usa bloqueos transaccionales PostgreSQL para coordinar escrituras,
catálogos e instancias, más versión optimista para las ediciones. Solo los cambios
efectivos generan auditoría. Un fallo de auditoría revierte la mutación.

La interfaz fija una copia de datos y versión al abrir una edición o confirmación.
Respuestas tardías no descartan cambios ni sustituyen esa versión. Un conflicto
409 conserva el borrador. Cancelar cierra y descarta la edición sin escribir.
El estado canónico PROXIMA_A_VENCER muestra “Próxima a vencer” como advertencia.

## Datos y despliegue local

Migración 20260923120000_suscripciones_gestion:

- suscripciones.version (entero, inicial 1).
- solicitud_id UUID único nullable y solicitud_hash nullable para compatibilidad
  con suscripciones históricas y futuras importaciones.
- actividad.usuario_id nullable para auditoría automática (origen: SISTEMA).
  Las acciones manuales siguen asociadas al usuario autenticado; se conserva la
  clave foránea con restricción de borrado.

La API y la ficha de cliente no devuelven claves de solicitud ni identificadores
operativos sensibles. Tampoco se incluyen en los nuevos snapshots de auditoría.
La gestión de credenciales operativas no forma parte de esta interfaz.

Desde backend:

    npm ci
    npx prisma migrate deploy
    npx prisma generate

Si se usa Docker, desde la raíz:

    docker-compose exec -T backend npx prisma generate
    docker-compose up -d --force-recreate backend

Migración ya aplicada y cliente Prisma local regenerado. No hace falta ejecutar
el seed, migrar alias del Excel ni cargar el histórico.

## Verificación

Desde backend:

    npm test -- --runInBand
    npm run test:integration
    npm run type-check
    npm run lint
    npm run build

Desde frontend: npm run build.

Para incluir la regresión de carga, desde backend:

    SUBSCRIPTIONS_LOAD_TEST=1 npm run test:integration

La suite normal omite esa prueba de 10.000 registros para mantenerla rápida.

Para las regresiones de navegador, arrancar el frontend y ejecutar desde frontend:

    npm run test:ui

Requiere Chrome instalado (por defecto /usr/bin/google-chrome). CHROME_PATH permite
indicar otro ejecutable y FRONTEND_TEST_URL otra URL local (defecto http://localhost:3000).
Usa playwright-core como dependencia de desarrollo; simula todas las respuestas
API y no modifica datos reales. No necesita iniciar sesión con credenciales reales.

El runner existente scripts/test-catalogos.cjs ahora ejecuta todas las suites
*.integration.spec.ts, incluidas suscripciones. Crea un esquema PostgreSQL
aleatorio catalogos_test_<uuid>, aplica las siete migraciones, usa fixtures y
elimina exclusivamente ese esquema al terminar. No apuntarlo a producción.
npm test omite esas suites si falta TEST_DATABASE_URL; usa el runner para
ejecutarlas con aislamiento verificado.

Resultados:

- 38 pruebas de integración normales: 19 de catálogos y 19 de suscripciones.
- 1 prueba de carga opcional, también superada: 10.000 registros procesados por
  lotes, sin auditorías duplicadas, con lectura concurrente independiente. En este
  entorno: lectura 815 ms y procesamiento completo 36,6 s, sin timeout transaccional.
- 10 unitarias: fechas y parser. Incluyen año bisiesto, días inválidos, zona horaria
  y límites del intervalo de aviso.
- API: autenticación, altas múltiples/idempotentes, concurrencia, catálogos inactivos,
  transiciones, umbral configurable, historial, paginación, snapshots conservados,
  correcciones, rollback y exclusión de campos sensibles.
- Se fuerza un fallo en el segundo lote y se comprueba que el primero permanece
  confirmado, las lecturas siguen disponibles y reintentar no duplica auditorías.
  También se prueban dos workers concurrentes y acciones con el worker indisponible.
- 4 regresiones UI de Chrome: etiqueta/advertencia, Cancelar sin escrituras,
  borrador y versión originales conservados ante recarga tardía, y versión
  original de una confirmación pendiente.
- Chrome contra API Nest real y PostgreSQL aislado: alta desde cliente, edición,
  suspensión, reactivación, cancelación y filtros. Cero errores JavaScript y cero
  renovaciones, movimientos e importaciones generados por esos flujos.
- Backend compilado en directorio temporal para no interferir con Docker. Frontend
  compilado sin avisos. Lint backend sin errores; ocho avisos previos en otros módulos.

El sprint 6 queda pendiente: renovaciones, cobros y movimientos financieros.
Recordatorios, dashboard y bloqueo externo siguen fuera de este sprint.
La validación operativa del Excel del sprint 3.5 continúa aplazada.

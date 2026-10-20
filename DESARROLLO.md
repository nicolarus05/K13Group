# Desarrollo local: Windows + Ubuntu WSL 2

## Windows

- Arrancar Docker Desktop, con motor WSL 2 e integración de Ubuntu.
- Abrir VS Code conectado a WSL desde PowerShell:
  `code --new-window --remote wsl+Ubuntu /home/nicolas/proyectos/K13Group`.
- Usar http://localhost:3000/login para la aplicación y http://localhost:3001/api/docs
  para la documentación de la API.
- No es necesario instalar Node o PostgreSQL directamente en Windows.

## Ubuntu WSL 2

El código y Git están en `/home/nicolas/proyectos/K13Group`.
Las herramientas Node, Prisma y Chromium se ejecutan en contenedores.
Git de Ubuntu usa Git Credential Manager de Windows para autenticar GitHub.
No usar la contraseña de GitHub como contraseña de Git por HTTPS.

```bash
cd /home/nicolas/proyectos/K13Group
./dev start
./dev status
./dev logs
./dev stop                  # conserva bases de datos y dependencias
```

`./dev start` espera a que la API y el frontend estén disponibles antes de terminar.
`./dev test-ui` comprueba esa disponibilidad antes de ejecutar el navegador.

El frontend y el backend se recargan al editar el código desde VS Code conectado a WSL.
Los procesos trabajan como UID/GID 1000 para no dejar archivos de proyecto propiedad de root.

## Comandos dentro de contenedores, lanzados desde Ubuntu

```bash
./dev backend npm run type-check
./dev frontend npm run type-check
./dev backend npm run lint
./dev frontend npm run lint
./dev test-backend
./dev test-integration
./dev test-ui
./dev build-backend
./dev build-frontend
./dev migrate
```

`test-backend` ejecuta pruebas unitarias; las integraciones requieren `test-integration`,
que crea y elimina un esquema temporal diferente por suite en PostgreSQL.
La prueba de carga opcional de suscripciones no se ejecuta por defecto.
Las pruebas UI necesitan el frontend arrancado; usan Chromium del contenedor y una API simulada.

`build-frontend` detiene temporalmente el frontend, compila con `NODE_ENV=production`
y lo vuelve a arrancar en desarrollo al terminar. No compilar simultáneamente con `next dev`
sobre el mismo volumen `.next`. El modo `development` de Compose no sirve para `next build`.

`build-backend` detiene la API, compila y la vuelve a arrancar esperando su estado
saludable. Usarlo en lugar de compilar sobre `nest start --watch`: durante la
revalidación se detectó un proceso antiguo ocupando el puerto 3001 (`EADDRINUSE`).

Para cambiar dependencias, hacerlo dentro de los contenedores. Después de cambios de lockfile:

```bash
docker compose stop frontend backend
docker compose run --rm --no-deps backend npm ci
docker compose run --rm --no-deps backend npx prisma generate
docker compose run --rm --no-deps frontend npm ci
docker compose up -d
```

Si VS Code necesita inspeccionar las dependencias de un contenedor para depuración o
autocompletado, puede conectarse a él con la extensión Dev Containers; los `node_modules`
se conservan en volúmenes Docker, no en la carpeta de Ubuntu.

## Servicios y datos locales

| Servicio | Dirección |
|---|---|
| Next.js | http://localhost:3000 |
| NestJS | http://localhost:3001/api/v1 |
| Swagger | http://localhost:3001/api/docs |
| PostgreSQL | 127.0.0.1:5432 |

Proyecto Compose: `k13group`. Base: `k13group`. Usuario de base: `k13user`.
La contraseña de PostgreSQL y las claves JWT son locales y están en `.env`, excluido de Git.
Solo se han inicializado los catálogos base y el usuario de desarrollo.
No se han importado las hojas de clientes del repositorio.

Acceso al entorno preparado:

- Usuario: `admin`.
- Contraseña: `DEMO_ADMIN_PASSWORD` del `.env` situado en la raíz del repositorio.

La contraseña inicial del seeder se sustituyó en esta base nueva por una clave local generada.
Los datos están en `k13group_postgres_data`. Los otros volúmenes contienen dependencias
y caché de Next. No usar `docker compose down -v` como comando de parada: elimina los datos.

## Preparación desde una copia nueva

1. Clonar en el sistema de archivos de Ubuntu. La terminal debe estar autenticada en GitHub.
2. Copiar `.env.example` a `.env`, generar contraseñas y claves JWT nuevas, y añadir
   `COMPOSE_PROJECT_NAME=k13group`. Mantener `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`.
3. Desde la raíz del repositorio, ejecutar:

```bash
docker compose build
docker compose up -d --wait db
docker compose run --rm --no-deps --user root backend chown -R 1000:1000 /app/node_modules
docker compose run --rm --no-deps --user root frontend chown -R 1000:1000 /app/node_modules /app/.next
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose run --rm --no-deps backend npm run db:seed
docker compose up -d
```

El seeder crea `admin` con la contraseña de desarrollo definida en `backend/prisma/seed.ts`;
la clave `DEMO_ADMIN_PASSWORD` documentada arriba corresponde a este equipo ya preparado.
En otra instalación, cambiar también la contraseña del administrador local tras el seeding.
En equipos con otro UID/GID, ajustar `user` y los comandos `chown` antes de arrancar.
Se requiere Compose 2.24.4 o posterior para `!override`.

## Comprobaciones del 6 de octubre de 2026

- Clonado con historial completo; base de trabajo `f15dd1d`.
- Imágenes construidas con `npm ci` y lockfiles sin modificaciones.
- 11 migraciones aplicadas y catálogos básicos inicializados.
- Backend: tipos y compilación correctos; 18 pruebas unitarias y 108 de integración correctas.
- Backend lint: 0 errores y 3 avisos preexistentes de importaciones sin usar.
- Frontend: tipos, lint y compilación en modo producción correctos.
- Pruebas UI en Chromium: **58 correctas, 0 fallidas**.
- Login API y consulta del usuario autenticado: HTTP 200.
- Acceso desde Windows al login web y Swagger: HTTP 200.

Durante la instalación npm avisa de una vulnerabilidad en Next 15.3.5.
Se conservan las versiones del repositorio para esta preparación local; la actualización
de seguridad debe revisarse antes de un despliegue. No se han actualizado dependencias
ni publicado el proyecto.

La preparación inicial se realizó en `chore/entorno-desarrollo`; en esta
comprobación aún no se había realizado commit ni push.
La identidad Git local usa Nicolás García Hernández y el correo privado de GitHub
`124302263+nicolarus05@users.noreply.github.com`.

## Revalidación del entorno: 7 de octubre de 2026

Paso 1 completado: Docker vuelve a responder desde Ubuntu WSL 2 (Engine 29.8.2).
PostgreSQL, backend y frontend están arrancados y saludables. Se ha comprobado
el arranque con `./dev start` y el acceso desde Windows al login y Swagger (HTTP 200).

- Tipos, lint y compilaciones de backend/frontend correctos. Se mantienen los
  tres avisos preexistentes de imports sin usar en el backend, sin errores.
- 18 pruebas unitarias, 108 de integración y 58 de interfaz aprobadas.
- Las integraciones usaron esquemas temporales; al terminar no quedó ninguno.
  Las pruebas UI usaron Chromium con API simulada. No se repitieron los cinco
  scripts E2E independientes ni la prueba de carga opcional en esta revalidación.
- Las 11 migraciones están aplicadas; no fue necesario ejecutar migraciones ni seed.
- Login API y consulta del usuario autenticado: HTTP 200.
- PostgreSQL conserva el volumen `k13group_postgres_data`. Las tablas operativas
  consultadas (clientes, suscripciones, movimientos e importaciones) siguen vacías.
- Tras compilar el frontend en producción se restauró su ejecución en desarrollo.

Esta comprobación cierra la recuperación del entorno, no los pendientes funcionales
y de seguridad detectados en la revisión del proyecto. No se han cambiado
dependencias ni realizado commit, push o despliegue.

## Paso 2: correcciones transversales, 7 de octubre de 2026

- Sesiones persistidas en la tabla existente `sesiones`, con identificador en los
  JWT y hash SHA-256 del refresh token. Access y refresh comprueban sesión vigente
  y usuario activo. Logout revoca ambos, incluso si el access ha caducado, sin
  cerrar las sesiones de otros dispositivos. Los tokens anteriores al cambio
  requieren iniciar sesión de nuevo.
- La web recupera el access con el refresh, agrupa renovaciones concurrentes y
  reintenta cada petición una sola vez. Los 401 tardíos reutilizan la renovación
  completada. Una sesión revocada termina en login; los fallos temporales no
  cierran sesión. El login permanece accesible con cookies inválidas. Si falla
  un cierre de sesión manual, muestra un error y permite reintentarlo.
- La duración de las cookies corresponde a la caducidad del JWT configurado.
  La sesión tiene vencimiento absoluto (7 días por defecto); refrescar no lo
  prolonga ni rota el refresh token. Se admiten renovaciones desde varias pestañas.
- `ThrottlerGuard` global activo: 100 peticiones por minuto por IP y endpoint;
  login limitado a 10. Devuelve 429 con `Retry-After`. Contadores en memoria de
  cada proceso; un despliegue con varias réplicas necesitará almacenamiento compartido.
  Referencia: https://docs.nestjs.com/security/rate-limiting.
- CORS admite `Idempotency-Key` para confirmar importaciones desde la web.
- Índice único parcial para teléfonos normalizados de clientes no eliminados.
  Altas/ediciones concurrentes duplicadas devuelven 409 y un mensaje visible.
  El borrado lógico y su auditoría son atómicos; si la auditoría falla se revierte
  el borrado. Un cliente eliminado no puede editarse y su teléfono puede reutilizarse.

Migración `20261007180000_clientes_telefono_unico` aplicada: 12 migraciones al día.
Normaliza los teléfonos existentes con las mismas reglas que la API. Si encuentra
duplicados, aborta toda la migración sin fusionar ni borrar clientes. El índice
parcial se mantiene en SQL, ya que no se expresa como un `@unique` global en Prisma.
Copia previa de PostgreSQL en
`/home/nicolas/backups/k13group/antes-paso2-20261007.dump` (fuera del repositorio).

Validación: 18 unitarias y 121 de integración aprobadas; 58 pruebas UI existentes
y 7 nuevas de autenticación aprobadas. Tipos, lint y compilaciones correctos,
con los mismos tres avisos previos del backend. Migraciones probadas desde cero
en esquemas temporales. Recorrido adicional en Chromium con API real: navegación
sin access, refresh único, logout y rechazo de tokens copiados. No se repitieron
los cinco scripts E2E de módulos ni la carga opcional; sus fixtures de autenticación
se han adaptado para crear sesiones persistidas.

El entorno queda arrancado en desarrollo. No se ha importado el histórico,
actualizado dependencias ni desplegado a producción. Al cerrar el paso 2 aún
no se había realizado commit/push. Estos cambios no cierran el sprint 13 completo.

## Paso 3: consolidación en Git, 7 de octubre de 2026

Cambios consolidados en la rama `chore/entorno-desarrollo` en dos commits locales:

1. `chore: preparar desarrollo reproducible en Windows y WSL`: Compose local,
   Dockerfiles con npm ci, Chromium, exclusiones Docker, comandos dev y documentación.
2. `fix: asegurar sesiones e integridad de clientes`: correcciones del paso 2,
   migración, pruebas de regresión y contrato de API actualizado.

Se ha revisado el contenido versionado: .env permanece ignorado y las copias de
datos y archivos generados quedan fuera de los commits. Compose, sintaxis de dev
y git diff --check correctos. No se han cambiado funcionalidades en este paso;
se conservan los resultados de pruebas del paso 2, sin repetirlas.
No se ha hecho push, merge ni despliegue.

## Publicación y planificación del sprint 11

Los commits del entorno y las correcciones se publicaron en GitHub y se integraron
en `main` mediante el merge `8f631ec`. Esto publica el código, no despliega la web.

La planificación completa del sprint 11, revisada el 8 de octubre de 2026, está en
[backend/SPRINT11.md](backend/SPRINT11.md) y resumida en el plan general. Incluye
contratos, datos, tareas, dependencias, API, pruebas y criterios de cierre, con
restauración desde la web, orden de métodos de pago y parámetros técnicos editables.
El sprint sigue pendiente de implementación.

## Configuración y recuperación

La administración está disponible en `/configuracion`. El servicio Docker
`recovery` ejecuta las copias y restauraciones manuales con herramientas PostgreSQL
16, dentro de WSL. Configurar `RECOVERY_SECRET` en `.env` con una clave aleatoria
independiente (por ejemplo, `openssl rand -hex 32`) y conservarla junto con los
secretos de infraestructura.

Consulta [la guía operativa de recuperación](recovery/README.md) para el uso desde
la web, los comandos de emergencia, la conservación externa y las pruebas aisladas.
No se ejecuta una restauración sobre la base de trabajo como parte de las pruebas.

## Lectura del Excel de clientes

`/importaciones` permite analizar XLSX/XLS, retomar lecturas guardadas y corregir
valores con versión, motivo e historial. La lectura 12.1 conserva los originales
y no habilita la creación de clientes, suscripciones ni cobros. PA no tiene
equivalencia de pago; PE significa pendiente de pago. Los datos opcionales vacíos
permanecen vacíos y las filas incompletas siguen visibles.

Límites: 10 MB de archivo, 64 MB descomprimidos para XLSX, 24 hojas, 20.000 filas
y 64 columnas por hoja, 500.000 celdas, 10.000 filas operativas y 10.000 caracteres
por celda. El análisis se ejecuta en un trabajador con límite de memoria y 20 s
de plazo; se admiten dos análisis simultáneos. No se recalculan fórmulas.

`./dev test-e2e-lectura` ensaya la web y la API con datos ficticios en el proyecto
Compose aislado `k13-lectura-test`, que se elimina al terminar. Tras compilar el
backend, puede ensayarse un archivo completo por stdin con
`docker compose exec -T backend node scripts/test-lectura-archivo.cjs < archivo.xlsx`.
Ese comando crea y elimina su propio esquema temporal y solo imprime recuentos.

En la misma pantalla, «12.3 · Revisar equivalencias y operaciones propuestas»
permite revisar producto, tarifa anual, servidor, referencia de origen y método
de pago. Las equivalencias pertenecen a cada análisis; las excepciones por fila
prevalecen. Antes de guardar se muestran todas las filas afectadas, incluidas las
de otras hojas que oculten los filtros. Cada decisión conserva autor, motivo,
versión e historial. Si cambia la lectura o el catálogo, las decisiones que
dependan de esos datos quedan pendientes de revisión.
Restaurar un valor de lectura anterior o reasignar el producto no rehabilita
automáticamente las decisiones invalidadas. La ruta antigua de equivalencias
globales rechaza los análisis 12.1 para preservar este aislamiento.

Un servidor ausente no recibe un valor masivo por defecto. COBRA y PROMAX
inactivos requieren confirmación de uso histórico y no se reactivan. La tarifa
debe corresponder al producto revisado y durar 12 meses; P.AÑO conserva el
importe histórico aunque difiera del precio actual. FECHA es el vencimiento;
TOTAL es acumulado y no genera ingresos. Las referencias propias propuestas
por identidad se muestran separadas de las referencias de origen.

La revisión distingue identidad, suscripción y finanzas. PA se ignora, PE
permanece pendiente de pago y asignar un método no acredita un cobro.
Las decisiones siguen en staging: no crean clientes, suscripciones, renovaciones,
referencias de catálogo ni movimientos. El ensayo web incluye ahora estas
equivalencias; el ensayo del archivo completo comprueba sus cinco inventarios,
el guardado idempotente y la ausencia de operaciones creadas.

«12.4 · Confirmar e importar datos revisados» permite seleccionar hasta 500
filas por lote, preparar una propuesta persistente y confirmar su aplicación.
La propuesta muestra clientes y referencias propias, servicios, periodos,
altas o renovaciones, ingresos confirmados, deudas PE y operaciones gratuitas.
La selección se conserva entre páginas. Los periodos del mismo servicio se
agrupan expresamente; las coincidencias con servicios existentes requieren
vinculación o confirmación de que son servicios distintos. Los solapes y los
periodos ya importados bloquean el lote.

La confirmación es una transacción: un fallo revierte clientes, referencias,
servicios, operaciones, movimientos y auditoría. El recibo queda guardado;
retomar o repetir un lote aplicado devuelve ese resultado sin duplicarlo.
El listado de lotes está paginado para poder recuperar también los antiguos.
Los recuentos del resumen se calculan a partir de los vínculos importados y se
actualizan al aplicar el lote; las filas excluidas no cuentan como pendientes.
Cualquier cambio relevante en lectura, identidad, equivalencias, catálogos o
datos de negocio exige preparar de nuevo la propuesta. Los lotes con finanzas
requieren una segunda confirmación expresa. PE genera exclusivamente deuda,
Gratis exige importe cero y no genera movimiento; PA y TOTAL no generan cobros.
Las fechas históricas de operación se obtienen del vencimiento menos un año,
ajustando el día al calendario. La deuda puede cobrarse después desde Renovaciones.

Se pueden importar solo clientes, o clientes y servicios, dejando las finanzas
pendientes. Teléfono, email y observaciones ausentes se guardan como `NULL`;
el cliente nuevo se crea `ACTIVO`. La referencia propia se revisa por separado
de la referencia de origen. Una identidad materializada no admite cambiar de
cliente, excluirse o reagruparse. Si el cliente se edita posteriormente, puede
revalidarse su misma vinculación con todas las filas de la identidad.
Los datos de lectura y equivalencias que ya originaron un servicio o una
operación quedan protegidos; las partes pendientes se pueden seguir revisando.
Al conservar un servicio importado para completar únicamente sus finanzas,
se mantienen sus fechas, estado y versión actuales, incluso si después se
suspendió o canceló. El cliente puede estar inactivo si se ha revalidado su
misma identidad. Los periodos ya conocidos se tienen en cuenta para impedir
registrar como alta un periodo posterior. La propuesta conserva y muestra el
método de pago antes de confirmar.

Los servicios de COBRA/PROMAX importados con uso histórico reciben el estado
`HISTORICA`: se consultan y filtran, pero no se reactivan, renuevan ni generan
recordatorios operativos. Sus operaciones conservan los importes y nombres de
catálogo revisados en sus snapshots.

El ensayo web aislado cubre ahora la confirmación 12.4 y la recuperación del
recibo tras recargar. El ensayo del XLSX completo mantiene todas sus filas en
un esquema temporal y aplica una fila revisada con sus vínculos y finanzas;
comprueba el reintento y elimina el esquema al terminar. Nunca realiza esa
carga en el esquema principal. Las pruebas de recuperación incluyen el recibo
de un lote aplicado. La carga definitiva del archivo se realiza por separado,
después de revisar las propuestas y disponer de una copia de seguridad actual.

## Exportaciones

Clientes, Suscripciones, Renovaciones, Finanzas y Estadísticas permiten descargar
Excel, CSV y PDF desde el botón «Exportar». Se incluyen todos los resultados con
los filtros y el orden actuales, independientemente de la página visible.
Renovaciones distingue seguimiento e historial. Estadísticas incluye sus ocho
informes, series, comparativas y clasificaciones completas; conserva las bases
y limitaciones del cálculo mostrado en pantalla.

La lectura usa una transacción Repeatable Read y una única fecha de referencia
de Madrid para todas las páginas, incluso al cruzar medianoche. La generación se ejecuta en un
trabajador separado con 256 MB y 20 segundos de plazo; se admiten dos solicitudes
simultáneas por proceso. Límites: 10.000 registros en Excel/CSV, 1.000 en PDF,
8 MB de datos, 20 MB de archivo, 32.767 caracteres por campo y 300 páginas PDF.
La consulta tiene un plazo de 30 segundos. Al superar un límite se rechaza el
archivo completo, sin truncarlo. El PDF divide tablas anchas en grupos de
columnas y repite el número de fila, las cabeceras y la primera columna.

Excel conserva teléfonos y referencias como texto, fechas como fechas e importes
como números. CSV utiliza UTF-8 con BOM, punto y coma y comillas escapadas;
neutraliza con apóstrofo los textos que podrían ejecutarse como fórmulas.
Al abrir CSV mediante el importador de Excel, seleccionar tipo Texto para
teléfonos y referencias para conservar ceros iniciales; XLSX ya define esos
tipos. Los campos ausentes permanecen vacíos y cero no equivale a vacío.
La referencia propia del cliente solo se exporta cuando existe una vinculación
explícita en la materialización; una coincidencia de nombre no acredita propiedad.
Los datos operativos restringidos no forman parte de las columnas exportables.
Finanzas conserva la descripción de los movimientos antiguos aunque no tengan
concepto. Renovaciones distingue el método original de la operación del método
y las fechas del cobro posterior; un importe cero sin método gratuito no se
presenta como una operación gratis.

La API usa POST /exportaciones/:modulo con formato (xlsx/csv/pdf), filtros y,
cuando corresponda, sección. No admite page/limit en los filtros. GET /exportaciones
pagina el historial. Todas las rutas requieren sesión. El historial registra
usuario, módulo, formato, fecha, estado, registros y tamaño; no almacena el archivo.
GENERADA acredita generación, no guardado en el ordenador. FALLIDA identifica un
intento fallido; GENERANDO sin resultado puede corresponder a un proceso
interrumpido. Configuración muestra la última exportación generada correctamente.

`./dev test-e2e-exportaciones` ejecuta el ensayo 12.1–12.4 y después descarga los
tres formatos de los cinco módulos desde el navegador en el Compose aislado.
Comprueba el historial y que las exportaciones no cambian los datos de negocio.
Deja únicamente un PDF ficticio de revisión en /tmp/k13-exportacion-ensayo.pdf.
Las pruebas de integración utilizan esquemas temporales. Ninguna de estas
pruebas carga datos ni genera exportaciones en el entorno principal.

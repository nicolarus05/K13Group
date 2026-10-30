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
- En este paso se añadió un índice único parcial para teléfonos normalizados.
  La importación definitiva del 22/10/2026 sustituye esa regla por contactos
  compartidos, según la decisión del usuario (véase actualización al final).
  El borrado lógico y su auditoría son atómicos; si la auditoría falla se revierte
  el borrado. Un cliente eliminado no puede editarse y su teléfono puede reutilizarse.

Migración `20261007180000_clientes_telefono_unico` aplicada: 12 migraciones al día.
Normaliza los teléfonos existentes con las mismas reglas que la API. Si encuentra
duplicados, aborta toda la migración sin fusionar ni borrar clientes. El índice
parcial se definió en SQL y se retira mediante la migración posterior
`20261021120000_clientes_telefonos_compartidos`; la normalización se conserva.
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

## Publicación y estado del sprint 11

Los commits del entorno y las correcciones se publicaron en GitHub y se integraron
en `main` mediante el merge `8f631ec`. Esto publica el código, no despliega la web.

El sprint 11 está implementado en `81fd8bc`: configuración, cuenta, preferencias,
catálogos y recuperación desde la web. La rama del sprint 12 incluye ese commit
como dependencia. A fecha del 21 de octubre de 2026, ambos sprints están publicados
en sus ramas de trabajo, pero todavía no se han integrado en `main`.

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
Ese comando crea y elimina su propio esquema temporal e imprime un resumen sin
datos identificativos de clientes ni credenciales.

«12.2 · Revisar identidades y duplicados» prepara una identidad por fila sin
fusionar clientes automáticamente por nombre. Permite agrupar, separar, excluir,
proponer un cliente nuevo o vincular uno existente, conservando motivo, versión e
historial. Los conflictos de teléfono y los cambios en el cliente de destino
requieren revisión. Las decisiones siguen en staging hasta confirmar un lote.

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
carga en el esquema principal. El informe identifica el archivo mediante SHA-256
y diferencia las filas con equivalencia de pago ensayada de las filas importadas.
Concilia los contadores de la interfaz, los vínculos de la operación, sus importes,
el estado y las fechas del movimiento, y los totales de ingresos y deuda con la
propuesta confirmada. Las pruebas de recuperación incluyen el recibo
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

## Verificación de cierre técnico del sprint 12 — 21 de octubre de 2026

Los pasos 12.1–12.5 están implementados y revisados en
`feat/sprint12-lectura-excel`, hasta `e102b35`. La revisión de cierre contrastó el
plan general con la lectura, las identidades, las equivalencias, la confirmación
transaccional y las exportaciones. No se detectaron defectos funcionales nuevos.
La integración en `main` y la importación definitiva siguen pendientes.

Se conservan los resultados de la revisión final de 12.5 sobre ese mismo código:
70 pruebas unitarias, 221 de integración, 101 de interfaz y 9 de recuperación
(401 en total), además del recorrido web 12.1–12.4 y 15 descargas reales en 12.5.
Tipos y compilaciones correctos; lint sin errores y con una advertencia previa
por `UseGuards` sin usar en Auditoría. La prueba opcional de carga masiva de
Suscripciones no forma parte de esos resultados. No se ha repetido la batería
completa para cambios de documentación, ayuda y comprobaciones del ensayo.

En el cierre se ejecutó de nuevo el ensayo del XLSX actual y se reforzó su
conciliación. Archivo: `Modelos Funcionales/CLIENTES 2026(Actualizado).xlsx`;
SHA-256: `47e158a3289fededa153b4c6eef30d04e6e7ba4816ed975d85e05a6c98191046`.
Se leyeron 12 hojas y 3.135 filas. Se ensayó una equivalencia de pago sobre 141
filas y se materializó **una sola fila revisada**: un cliente, un servicio, una
operación y un movimiento. El resultado dejó 3.134 filas pendientes y ninguna
excluida; los ingresos del ensayo fueron 30 EUR y la deuda 0 EUR, coincidentes
con la propuesta. Esto no acredita una importación completa del archivo.

El análisis inicial detectó 4 filas sin nombre y 75 identidades en conflicto.
Los diagnósticos incluyen 936 incidencias financieras y 787 de suscripción;
pueden coincidir en una misma fila y requieren revisión antes de la carga real.
No se han resuelto mediante datos inventados ni aprobaciones automáticas.

Las 18 migraciones están aplicadas. Tras el ensayo se comprobaron cero clientes,
servicios, operaciones, movimientos, análisis, filas, identidades, decisiones de
equivalencia, lotes y exportaciones en el esquema principal, y cero esquemas de
ensayo pendientes. Los cuatro servicios Docker están saludables.

La rama remota contiene los cinco commits de implementación del sprint 12 y
depende de los dos commits del sprint 11 aún no integrados en `main` (`8f631ec`).
La comprobación del remoto se realizó por GitHub y mediante `git fetch` desde WSL.
En esta sesión, Git Credential Manager requirió propagar `PATH` a Windows con
`WSLENV=PATH/lp` e incluir el directorio de `git.exe` del runtime; se aplicó solo
al comando, sin cambiar la configuración persistente ni las credenciales.

La carga definitiva requiere revisar las identidades, equivalencias y propuestas
del archivo elegido y disponer de una copia de seguridad actual validada. Su
conciliación deberá abarcar todos los lotes aplicados y las filas que se dejen
pendientes o excluidas; los resultados del ensayo parcial no la sustituyen.


## Adaptación para la carga definitiva — 22 de octubre de 2026

Los clientes pueden compartir teléfono. Se conserva su normalización para buscar
coincidencias, pero ya no es una clave única ni provoca fusiones automáticas. La
migración `20261021120000_clientes_telefonos_compartidos` retira únicamente el
índice único; no cambia nombres, contactos ni fichas existentes.

Las decisiones explícitas de 12.2 permiten crear clientes distintos con el mismo
contacto. La ruta antigua de confirmación exige volver a analizar los archivos
pendientes porque deducía identidades por teléfono/nombre. Los análisis antiguos
ya completados siguen siendo consultables sin repetir escrituras.

Verificación de esta adaptación: 70 pruebas unitarias, 223 de integración y 9 de
recuperación aprobadas. Incluye altas y ediciones concurrentes con teléfono
compartido, decisiones de identidad independientes y dos importaciones con el
mismo teléfono cuyos reintentos no duplican clientes, servicios ni cobros. La
compilación del backend es correcta. Las 19 migraciones están aplicadas. Estos
resultados no sustituyen la conciliación de la carga completa del XLSX.

La revisión de equivalencias indexa los catálogos por identificador, nombre y
precio anual para evitar recorrer todas las referencias por cada celda. Se
compararon las filas, catálogos, sugerencias y huella de las 3.135 filas antes y
después: resultados idénticos. Las 16 pruebas de equivalencias, 23 de aplicación
y 26 de exportaciones pasan con esta optimización; tipos y lint sin errores
(permanece el aviso previo de `UseGuards` en Auditoría).

El ensayo completo se realizó en una base PostgreSQL aislada con una copia de la
revisión real. El piloto se confirmó desde Chromium contra la API real; después
se aplicó el resto de la selección. Resultado: 3.123 clientes, 2.655 servicios y
2.652 altas históricas, con 2.647 cobros por 211.710 EUR y cinco deudas PE por
370 EUR. Los 23 lotes del ensayo soportaron reintentos sin duplicados. Se
conciliaron nombres, teléfonos, fechas, tarifas, referencias e importes fila por
fila; Importaciones, Clientes, Suscripciones, Finanzas y Dashboard se verificaron
desde el navegador sin errores JavaScript ni respuestas HTTP 5xx.

La revisión registra 767 asignaciones individuales a DEAD para servidores vacíos,
las equivalencias de las aplicaciones reconocidas, 1.517 referencias de origen y
70 tarifas anuales adicionales con los importes positivos del Excel. COBRA y
PROMAX permanecen inactivos: sus servicios importables son históricos.

Se conservaron en el historial estas correcciones autorizadas: MAY 5 vence el
12/05/2026; SEP 125 no lleva la coma en ESTADO; OCT 291 y SEP 186 usan Gratis
(código GR) con importe cero. El XLSX original no se ha sobrescrito. Los periodos
se registran como altas iniciales con fecha de operación/cobro igual al
vencimiento menos un año. PA no genera un movimiento y PE nunca se marca cobrado.

Copia previa a la carga principal: `7cdd2313-03ad-4568-80bf-0db59d6b2d00`, con
19 migraciones y validación de restauración completada. TAR e inventario firmado
con SHA-256 comprobado en
`/home/nicolas/.local/share/k13group/backups/pre-importacion-20261022/`.
Es almacenamiento local del equipo, además del volumen Docker de recuperación.

La carga definitiva se aplicó al esquema principal en 22 lotes, después del
ensayo. La conciliación independiente y los reintentos verificaron exactamente
los mismos 3.123 clientes, 2.655 servicios, 2.647 cobros (211.710 EUR) y cinco
deudas (370 EUR). Las 2.652 operaciones son altas históricas. La web principal
se comprobó de nuevo en los cinco módulos sin errores detectados. El entorno
principal **ya contiene datos importados**; no está vacío.

Al terminar la carga inicial, las 3.135 filas seguían trazables: 3.131 tenían cliente vinculado, ocho pares
comparten la identidad revisada y OCT 312–315 continúan pendientes por falta de
nombre. No hay filas excluidas. Quedan 480 filas sin servicio y 483 sin operación
financiera (categorías solapadas). Entre las primeras hay 461 sin importe, siete
con importe cero y 19 sin aplicación reconocida; las cifras también se solapan.
Las seis gratuidades confirmadas necesitan una tarifa antes de importar su
servicio. MAY 165 conserva la contradicción entre cero y Stripe. Los tres
servicios pendientes solo de finanzas son JUL 8, OCT 17 y ENE 143 (PA ignorada).
No se han creado importes, teléfonos, aplicaciones ni pagos ficticios.

Copia posterior a la carga: `1da37675-2a17-4b35-82f9-2353f152975f`, con
validación de restauración completada. TAR e inventario firmado descargados con
SHA-256 comprobado en
`/home/nicolas/.local/share/k13group/backups/post-importacion-20261022/`. La base
aislada y los dumps temporales del ensayo se han eliminado; permanecen las copias
previa y posterior.

## Exclusión de clientes sin renovación — 23 de octubre de 2026

El usuario confirmó que las filas sin P.AÑO **y** sin método de pago corresponden
a clientes que no han renovado y autorizó excluir las 461 filas afectadas y
retirar las 457 fichas ya creadas. La regla exige ambos campos ausentes: no
incluye importes cero, gratuidades, PE ni filas con solo uno de los datos ausente.
Las cuatro filas sin ficha (OCT 312–315) también quedan excluidas, sustituyendo
la decisión anterior de mantenerlas pendientes.

Se aplicó una corrección administrativa atómica al análisis
`f6cf3b87-2d6b-4453-9639-e9085d7bb6a0`, identificada por
`bca7e391-95f0-49ca-b85c-96ca621cae84`. Antes de retirar las fichas se verificó
que no tuvieran suscripciones, recordatorios ni otras filas vinculadas. Las
457 fichas conservan sus datos mediante borrado lógico; las 461 identidades
quedan excluidas con historial y auditoría. Se mantienen las 3.135 filas de
origen, sus vínculos históricos y el XLSX original. La corrección genera 457
eventos de retirada, 461 de exclusión y un evento conjunto de auditoría.

Resultado tras esta retirada: **2.666 clientes visibles**, 461 filas excluidas, **19 filas
pendientes de servicio y 22 pendientes de operación financiera**. Estos dos
últimos conjuntos se solapan. Permanecen 2.655 servicios, 2.652 altas históricas,
2.647 cobros por 211.710 EUR y cinco deudas por 370 EUR. Las huellas SHA-256 de
servicios, operaciones, movimientos, referencias y lotes coinciden exactamente
antes y después de la corrección.

El ensayo en una copia aislada comprobó la reversión íntegra al provocar un
fallo dentro de la transacción y la repetición sin nuevas escrituras después de
aplicarla. La API y Chromium contra el entorno principal verificaron Clientes,
el análisis guardado, las identidades excluidas y la revisión de aplicación,
sin errores JavaScript ni respuestas HTTP 5xx. No aparecieron identidades en
conflicto ni pendientes de revalidación por esta corrección.

Copias previa `54f49673-e150-4198-bc12-123bc99ab924` y posterior
`b938c4b3-ba59-479c-84c2-6748031462b6`, ambas con prueba de restauración
completada. TAR e inventarios firmados se conservaron fuera del volumen Docker,
con SHA-256 comprobado, en los directorios locales
`/home/nicolas/.local/share/k13group/backups/pre-retirada-20261023/` y
`/home/nicolas/.local/share/k13group/backups/post-retirada-20261023/`.
La base aislada y su dump temporal se eliminaron tras las comprobaciones.

## Resolución de las últimas filas del XLSX — 23 de octubre de 2026

El usuario confirmó las equivalencias BOB → BOB PLAYER, KDSLPAYER → KDSPLAYER,
O PLAYER → 0 PLAYER (producto existente del catálogo), y 20 PLATFORM, ONE y
APPLE TV → MAXPLAYER. Se guardaron decisiones por fila, conservando los valores
originales del Excel. Para ENE 9 se creó una tarifa anual de BOB PLAYER de 10 EUR,
conforme a P.AÑO. Los servicios de importe cero utilizan la tarifa anual de
referencia de 75 EUR de su producto, pero su operación histórica permanece
gratuita, sin movimiento financiero ni cobro.

Las correcciones de pago conservan el historial: MAY 165 usa Gratis (GR) con
importe cero; ENE 143 usa Bizum Revolut (B-RE), por 75 EUR; JUL 8 usa Efectivo
(EF), por 10 EUR. El usuario confirmó que FEB 9 duplica la operación de ENE 9:
se conservó ENE 9 y se excluyó FEB 9, retirando su ficha duplicada mediante
borrado lógico. Los servicios de Alfonso en SEP 278 y OCT 282 se conservaron
como dos servicios distintos, tal como confirmó el usuario.

OCT 17 quedó excluida por no renovación. Se comprobó que su cliente solo tenía
ese servicio y que no había operaciones ni movimientos asociados. La ficha y
el servicio se retiraron mediante borrado lógico; el servicio quedó cancelado
y su recordatorio automático cerrado. Se conservaron los vínculos originales,
los recibos de los lotes anteriores y los eventos de auditoría. Estas retiradas
están identificadas por la corrección `f7a5d310-754c-4953-8b55-12003a205081`.

Después del ensayo aislado se aplicó al entorno principal el lote
`94fdd9e0-095c-4fad-b71b-c268896f1d0b`: **20 operaciones históricas**, con
**18 servicios nuevos**, **siete gratuidades sin movimiento financiero** y
**13 cobros por 910 EUR**. Dos operaciones completan servicios ya existentes.
El reintento de confirmación devuelve el mismo resultado sin duplicados.

Resultado actual de las 3.135 filas: **2.672 completadas y 463 excluidas; cero
pendientes de servicio u operación financiera**. Hay **2.664 clientes visibles**,
**2.672 servicios visibles**, **2.672 operaciones** y **2.665 movimientos**:
2.660 cobros confirmados por **212.620 EUR** y cinco deudas PE por **370 EUR**.
Las 459 fichas retiradas y el servicio retirado permanecen físicamente para
conservar el historial. El análisis sigue consultable en su flujo de revisión.

La conciliación independiente verificó cada una de las 20 filas: producto,
importe, método, fechas históricas, operación ALTA y ausencia de movimiento
para las gratuidades. Las operaciones y movimientos preexistentes no cambiaron.
Se comprobó la cancelación del recordatorio de OCT 17 y que los servicios de
Alfonso fueran distintos. Clientes, Importaciones, Suscripciones y Finanzas
se verificaron con Chromium y la API reales, sin errores JavaScript ni HTTP 5xx.
El SHA-256 del XLSX original sigue siendo
`47e158a3289fededa153b4c6eef30d04e6e7ba4816ed975d85e05a6c98191046`.

Copia previa `5bdd6b61-6496-49b9-a580-2fdb979424b9` y posterior
`bf204d38-39d6-4a7f-b803-44771331ab55`, ambas con restauración de prueba
completada. TAR e inventarios firmados descargados con checksum verificado en
`/home/nicolas/.local/share/k13group/backups/pre-resolver-pendientes-20261023/`
y `post-resolver-pendientes-20261023/` bajo el mismo directorio de copias.
Se eliminaron la base aislada y el dump temporal del ensayo.

## Revisión completa posterior a la importación — 23 de octubre de 2026

Se volvió a leer el XLSX original y se conciliaron sus 3.135 filas de las 12
hojas con la base principal. Se verificaron los datos originales, las siete
correcciones de lectura autorizadas, los nombres y contactos, las agrupaciones,
las 463 exclusiones, las equivalencias, las fechas, los importes, los métodos
de pago, las instantáneas históricas y los vínculos de los 23 lotes. No se
detectaron discrepancias ni registros huérfanos. Tres teléfonos de filas
agrupadas difieren únicamente en los espacios; conservan el mismo número y
su representación original en el análisis.

La revisión detectó y corrigió dos defectos de código:

- Reintentar una propuesta reconstruida desde JSONB podía rechazarla por el
  orden de sus claves. Ahora se compara también el contenido estructural,
  normalizando el valor predeterminado `servicioDistinto=false`. Se mantienen
  las comprobaciones de autor, importación y contenido: un cambio real sigue
  rechazándose. No es necesario reescribir los lotes ni sus recibos históricos.
- El formulario de clientes atribuía cualquier respuesta 409 a un teléfono
  duplicado, aunque los contactos compartidos están permitidos. Ahora muestra
  el mensaje real del servidor. Se probó el rechazo simulado en navegador sin
  enviar altas reales a la API.

Se actualizó el comentario del esquema sobre teléfonos compartidos y se retiró
la importación sin uso de `UseGuards` en Auditoría. No se modificaron los datos
de clientes, servicios ni finanzas durante esta revisión.

Verificación: 70 pruebas unitarias, 224 casos distintos de integración (batería
general de 223 y repetición de los 24 casos de aplicación, incluida la nueva
regresión), 101 pruebas de interfaz y nueve de recuperación aprobadas. Tipos
de frontend y backend correctos; lint del backend y del archivo frontend
modificado sin errores ni avisos.

En una copia aislada se ejecutaron 69 reintentos sobre los 23 lotes: propuesta
guardada, propuesta con transformación del DTO HTTP y confirmación. Las huellas
de las 13 tablas comprobadas permanecieron idénticas. Chromium verificó
Clientes, Importaciones, Suscripciones, Finanzas, Dashboard, Estadísticas y
Recordatorios sin errores JavaScript ni HTTP 5xx. Las exportaciones completas
de clientes, servicios, operaciones y finanzas coinciden con sus recuentos;
las operaciones incluyen siete gratuidades y las finanzas suman 212.620 EUR
cobrados y 370 EUR pendientes. Las fichas y el servicio retirados no son
accesibles desde sus rutas operativas.

La copia `bf204d38-39d6-4a7f-b803-44771331ab55` volvió a superar la restauración
de prueba. Las 19 migraciones están aplicadas y el índice de teléfono es no
único. Se eliminaron la base aislada, su dump y la copia temporal del XLSX.
El resultado sigue siendo 2.672 filas completadas, 463 excluidas y cero
pendientes de servicio u operación financiera.

## Cierre de la integración del XLSX — 23 de octubre de 2026

La última revisión volvió a conciliar las 3.135 filas con el XLSX original y
verificó individualmente las 20 operaciones del lote final. No aparecieron
discrepancias, periodos repetidos para el mismo dispositivo, lotes sin aplicar
ni recordatorios abiertos de fichas retiradas. Se conserva el resultado:
2.664 clientes visibles, 2.672 servicios y operaciones, siete gratuidades sin
movimiento, 2.660 cobros por 212.620 EUR y cinco deudas PE por 370 EUR.
Las 463 filas excluidas conservan trazabilidad; no quedan filas pendientes.

La batería completa de integración, con las correcciones de la revisión
anterior incluidas, pasó sus 224 pruebas en 14 suites. Las comprobaciones de
tipos de ambos proyectos y lint del backend terminaron correctamente.
Se repitió la verificación de las siete pantallas desde Chromium y la API real,
incluida la comprobación del mensaje de conflicto sin altas reales de prueba.
No se detectaron nuevas incidencias.

Copia de cierre: `e569fcc6-bf81-4f5b-8054-1755ef04cbde`, con restauración de
prueba completada. TAR e inventario firmado guardados también en
`/home/nicolas/.local/share/k13group/backups/cierre-integracion-20261023/`,
con checksum verificado. La integración queda finalizada y validada; las
deudas PE son saldos de negocio pendientes de cobro, no tareas de importación.

## Sprint 13 implementado — 24 de octubre de 2026

La rama `feat/sprint13-auditoria-seguridad` incorpora la pantalla **Auditoría**
y las rutas autenticadas `GET /auditoria`, `/auditoria/filtros` y
`/auditoria/:id`. Permiten filtrar módulo, acción, usuario/sistema, registro e
intervalo; el cursor ordena por fecha e identificador, con corte temporal y
límite de 100 registros. El listado no entrega instantáneas completas. El
detalle oculta campos sensibles, muestra los valores registrados antes/después
y permite consultar el historial de registros retirados. No existen rutas para
modificar o eliminar actividad. La aplicación mantiene su modelo de usuario
administrador autenticado; no se ha introducido un sistema nuevo de roles.

El contrato de actividad conserva actor (nulo para sistema), fecha, módulo,
registro y acción. Las instantáneas y motivos se muestran cuando existen;
los eventos anteriores no se reconstruyen ni se reescriben. La comparación
solo usa campos presentes en ambos estados y reconoce los sobres de cambios
de configuración. Altas, ediciones y retiradas de clientes guardan ahora sus
instantáneas en la misma transacción; el bloqueo de fila conserva el estado
anterior real ante editores concurrentes. Las dos escrituras antiguas del
importador (equivalencia y revisión de fila) también comparten transacción con
su auditoría. Las correcciones de lectura añaden valores anteriores/cambios
redactados, y las decisiones de equivalencias incluyen motivo y destino.
Los módulos existentes conservan sus registros de suscripciones, operaciones,
finanzas, recordatorios, catálogos, configuración, exportaciones y recuperación.

Se registran inicio y cierre de sesión sin tokens. El guard global comprueba
el origen de las escrituras de navegador, incluido el login, además de la
autenticación, CORS, cookies, revocación y limitación de peticiones existentes.
El filtro de errores conserva las validaciones de formularios y no publica
excepciones internas: los errores de servidor tienen identificador correlacionado
con un log de método, plantilla de ruta y estado, sin cuerpo, URL con parámetros
ni consulta SQL. El historial global y los historiales de suscripciones,
finanzas y configuración aplican ocultación a los datos sensibles históricos.

**Configuración → Copias** incorpora programación con contraseña, motivo y
control de versión. Parte desactivada, con valores iniciales de 24 horas y siete
copias. El worker reutiliza el motor existente, espera operaciones/mantenimiento,
recupera una ejecución pendiente al arrancar y evita duplicados con inventario
persistente. Los fallos se muestran en la web y se reintentan tras 15 minutos.
La conservación afecta solo a copias programadas y se ejecuta después de una
nueva copia completada; conserva las manuales y previas a restauraciones.
El listado distingue los tres tipos. La política sigue **desactivada en el
entorno principal**, pendiente de fijar la frecuencia y conservación definitivas.

La migración `20261024100000_auditoria_indices` está aplicada: hay 20 migraciones
y tres índices de consulta de actividad. No modifica registros de negocio.
Durante los ensayos se corrigieron el nombre accesible de los filtros, la
comparación incorrecta de campos ausentes en instantáneas parciales y una alarma
de programación cuando un worker nuevo arrancaba antes de crear las tablas.

Validación de esta implementación: 233 pruebas de integración en 15 suites
(la batería completa de 232 y la nueva regresión de auditoría, con su suite de
nueve repetida), 76 unitarias, 104 de interfaz y 16 de recuperación/programación.
Las suites de lectura y equivalencias se repitieron después de ampliar sus
registros. Compilaciones de backend y frontend, tipos y lint sin errores.
`./dev test-e2e-auditoria` usa el proyecto aislado `k13-sprint13-test`: Chromium
crea una ficha, comprueba edición/retirada e historial, configura la programación,
espera la copia real, valida su restauración temporal y comprueba que reiniciar
API/worker conserva una sola copia. Los volúmenes de ensayo se eliminan al salir.

En el navegador contra el entorno principal se comprobaron Auditoría y Copias,
las cabeceras de seguridad y los 23 lotes aplicados, sin errores JS ni HTTP 5xx.
Los hashes y recuentos de nueve tablas de clientes, importación, referencias,
servicios, operaciones y movimientos coinciden antes/después. Se mantienen
2.664 clientes visibles, 2.672 servicios y operaciones, 2.660 cobros por 212.620 EUR
y cinco deudas PE por 370 EUR. No se crearon fichas de prueba en este entorno.

Copia previa a los índices: `a3ee8765-f720-46a8-99c7-ba3d17d8b074`.
Copia con el esquema actualizado: `06c63199-cec7-4166-8571-23365f5fb3b2`,
restauración de prueba completada en el trabajo
`18104f4c-c4ba-448e-afc5-9354ec59efc1`. TAR e inventario firmado guardados también
con permisos privados y checksum verificado en
`/home/nicolas/.local/share/k13group/backups/sprint13-20261024/`.
Esta copia está fuera del volumen Docker pero permanece en el mismo equipo.

## Revisión del Sprint 13 — 25 de octubre de 2026

La revisión detectó y corrigió cinco fallos con pruebas de regresión:

- Un `schedule.json` malformado podía detener el trabajador de recuperación.
  Ahora se captura el error; un fallo al persistir el estado tampoco detiene
  el proceso.
- Un error de limpieza de copias esperaba el intervalo de copia siguiente en
  lugar de reintentarse a los 15 minutos. La limpieza pendiente se conserva y
  reintenta sin generar otra copia; antes de borrar se verifica la integridad
  de la copia que permite aplicar la conservación.
- Los cambios de conservación o la desactivación durante una copia larga
  podían ignorarse al limpiar. El trabajador relee la política antes de borrar.
- Actualizar Auditoría desde una página posterior podía recuperar la primera
  página de caché sin consultar datos nuevos. Ahora invalida el listado y sus
  filtros al volver al inicio.
- Algunas fechas ISO no compatibles con JavaScript/PostgreSQL provocaban un
  error 500. La API valida fechas de calendario y cursores y devuelve 400.

La web muestra el momento del reintento de programación separado de la próxima
copia. Se comprobó además que un fallo al escribir auditoría revierte tanto
la creación de sesión como su revocación, sin dejar cambios parciales.

Validación: 76 pruebas unitarias, 234 de integración en 15 suites (233 en la
batería completa y la regresión adicional de sesión, con la suite de auditoría
de diez repetida), 105 de interfaz y 23 de recuperación/programación aprobadas.
Las compilaciones de backend y frontend y las comprobaciones de tipos y lint
del proyecto finalizaron correctamente. El ensayo aislado de Chromium pasó
alta/edición/retirada, historial, programación desde la web, restauración de
prueba y reinicio sin duplicar copias. Los casos adicionales de cambio de
política durante la copia pasaron en la batería de recuperación posterior.

El navegador contra el entorno principal confirmó 2.664 clientes visibles,
2.672 servicios y operaciones, 23 lotes auditados, 2.660 cobros por 212.620 EUR
y deuda PE por 370 EUR, sin errores JavaScript ni HTTP 5xx. Las copias automáticas
siguen desactivadas y los cuatro servicios Docker están saludables.

Ocho de las nueve tablas de negocio comparadas conservan exactamente sus
recuentos y hashes. La diferencia en suscripciones corresponde exclusivamente
a tres transiciones `ACTIVA` → `PROXIMA_A_VENCER` registradas por el proceso
automático al comenzar el 25 de octubre. Al deshacer esos tres cambios solo en
memoria (estado, versión y fecha de actualización), el hash coincide con el
inicial; esta comprobación no escribe en la base de datos. El XLSX conserva su
SHA-256, siguen aplicadas las 20 migraciones y no quedan esquemas temporales
de integración. No se detectaron incidencias pendientes en estas comprobaciones.


## Sprint 14 implementado — 27 de octubre de 2026

Se incorpora un entorno de calidad desechable para WSL/Docker, independiente de
los puertos, volúmenes, credenciales y datos del entorno principal. `./dev quality
check` compila versiones de producción y ejecuta auditoría de dependencias, tipos,
lint, pruebas unitarias, integración, interfaz, recuperación y navegador. Los
comandos `benchmark`, `browser` y `soak` y sus evidencias se describen en
[quality/README.md](quality/README.md). La configuración de GitHub Actions ejecuta
las comprobaciones en PR y cambios de main; las mediciones son opcionales. El
workflow tiene sintaxis comprobada y sus comandos se probaron localmente;
todavía no se ha ejecutado en GitHub.

Las consultas de filtros de auditoría agrupan ahora en PostgreSQL, evitando cargar
todos los eventos para deduplicarlos en Node. El resumen de clientes de Estadísticas
agrega los servicios una vez y conserva los filtros, bajas, borradores y clientes
sin servicios. La migración 21 añade el índice de movimientos por operación y
estado. En la comparación SQL con datos sintéticos x10, el informe anterior y el
nuevo coinciden exactamente; desaparecen los 6.680 barridos completos repetidos
de movimientos que explicaban la principal demora.

Se corrigen tres casos de datos obsoletos en caché, reproducidos antes de aplicar
la corrección: un nuevo login dentro de la misma aplicación, la edición del nombre
de un cliente y la edición de un producto del catálogo. Las vistas relacionadas
se invalidan tras guardar, manteniendo la navegación sin recarga. La revisión
de identidades/equivalencias/aplicación y las pantallas de copias se cargan bajo
demanda. Los formularios distinguen los tipos de entrada y salida de Zod 4.

Las imágenes locales y de calidad usan Node 22. Se actualizan las dependencias y
se acotan las sustituciones de paquetes transitivos vulnerables; las dos auditorías
instaladas devuelven cero vulnerabilidades conocidas. La distribución oficial de
SheetJS 0.20.3 interpreta exactamente las mismas 12 hojas y 3.135 filas del XLSX
real que la versión anterior: coincide el hash del resultado completo del parser,
sin reimportar ni modificar datos. Los detalles y fuentes de las actualizaciones
están en la documentación del entorno de calidad.

Validación: 84 pruebas unitarias, 236 de integración en 16 suites, 108 de interfaz
y 23 de recuperación/programación aprobadas. Se incluyen cambios de horario de
Madrid, equivalencia del resumen SQL, tres regresiones de caché y la prueba de
10.000 suscripciones con lectura concurrente y auditoría sin duplicados. Tipos,
lint y compilaciones de ambas aplicaciones correctos. Chromium comprobó doce
pantallas de producción, cookies, renovación/cierre de sesión, protección de
origen y Swagger desactivado; también pasó alta/edición/retirada, programación
de copias, restauración temporal y persistencia tras reiniciar API y worker.
La batería completa aislada está en `quality/results/20261026T231808Z-277098/`;
las últimas correcciones de catálogo se verificaron después con las 108 pruebas
de interfaz y los dos casos de navegación sin recarga.

El entorno principal ya ejecuta Node 22.23.4 y las 21 migraciones. El navegador
confirmó 2.664 clientes visibles, 2.672 servicios y operaciones, 23 lotes aplicados,
2.660 cobros por 212.620 EUR y deuda PE por 370 EUR, sin errores JavaScript ni 5xx.
Las copias automáticas continúan desactivadas y los cuatro servicios están
saludables. No quedan esquemas temporales de pruebas en la base principal.

Las nueve tablas de negocio comparadas conservan sus hashes antes/después de la
actualización; las seis nuevas entradas de auditoría corresponden al acceso y
cierre de sesión y a crear/validar las dos copias. Frente al inicio del sprint,
las ocho transiciones automáticas de suscripciones y sus ocho recordatorios al
comenzar el 27 de octubre explican los otros cambios: al reconstruir el estado
anterior solo en memoria, vuelve a coincidir el hash de suscripciones. El XLSX
conserva su SHA-256 `47e158a3289fededa153b4c6eef30d04e6e7ba4816ed975d85e05a6c98191046`.

Copia previa a la actualización: `c6f65038-3072-42e4-88e0-dc7e551d0c4e`.
Copia con el esquema 21: `3f5df854-858e-4b0a-ba3a-5e71f6242456`. Ambas se validaron
mediante restauración temporal. Sus TAR e inventarios firmados están también en
`/home/nicolas/.local/share/k13group/backups/sprint14-20261027/`, con permisos
privados y checksums verificados; permanecen en este mismo equipo.

Las mediciones HTTP finales completaron 637 solicitudes por escala (1.274 en
total), con sesiones válidas y sin errores. Estos son los p95 en milisegundos
para diez sesiones concurrentes; cada escenario contiene 30 muestras:

| Ruta | Base x1 | Final x1 | Base x10 | Final x10 |
| --- | ---: | ---: | ---: | ---: |
| Clientes | 13 | 22 | 25 | 36 |
| Suscripciones | 26 | 32 | 27 | 34 |
| Finanzas | 27 | 27 | 27 | 39 |
| Dashboard | 103 | 114 | 555 | 762 |
| Estadísticas | 163 | 50 | 6.224 | 473 |
| Auditoría: listado | 10 | 10 | 10 | 18 |
| Auditoría: filtros | 111 | 57 | 1.088 | 61 |

La mejora se concentra en Estadísticas y los filtros de Auditoría; las otras
rutas no mejoraron de forma uniforme y Dashboard aumentó de 555 a 762 ms a
escala x10. Son muestras locales en WSL con Node/dependencias actualizados, no
una garantía de rendimiento en producción. Dashboard además usa el día de
negocio actual, que cambió entre las ejecuciones. Evidencias finales:
`quality/results/20261026T232815Z-281573/` y
`quality/results/20261026T232916Z-282254/`. Ambos ensayos compilaron también
la última corrección de caché del catálogo en modo de producción.

El ensayo de cinco minutos mantuvo diez sesiones y completó 1.450 consultas
sin errores, con p95 por ruta entre 16 y 96 ms. Durante la carga se completaron
una copia real, una exportación de clientes a XLSX y otra de finanzas a CSV;
los archivos se comprobaron y las exportaciones tardaron menos de un segundo.
Las muestras de RSS de la API oscilaron entre 180 y 245 MiB y las conexiones
a PostgreSQL entre 13 y 17. Esta duración no demuestra ausencia de fugas a
largo plazo. Evidencias: `quality/results/20261026T231152Z-274416/`.


## Revisión del Sprint 14 — 27 de octubre de 2026

Se corrigieron tres fallos reproducidos durante esta revisión:

- Una renovación de sesión anterior que devolvía 401 podía cerrar una sesión
  recién iniciada. El login espera las respuestas de renovación/cierre automático
  pendientes, las peticiones se identifican por sesión y las respuestas antiguas
  no se reintentan con la sesión nueva. Esas esperas de red tienen un límite de
  15 segundos por petición. Dos regresiones de navegador cubren la renovación
  anterior aceptada y rechazada, el orden de las respuestas y la ausencia de
  reintentos de peticiones anteriores.
- Importaciones solicitaba clientes con `sort=nombre:asc`, que la API rechaza.
  Usa ahora `sort=nombre`; el tipo de consulta admite únicamente los tres valores
  que acepta el backend. El recorrido real detectó el 400 antes de corregirlo y
  volvió a pasar después.
- El registro de huellas de calidad fallaba si había archivos eliminados en Git.
  Ahora conserva las eliminaciones en el estado del árbol y calcula huellas de
  los archivos presentes. Se comprobó con archivos eliminados, nuevos, con
  espacios y con guion inicial; también registra los cambios preparados en Git.

El recorrido de producción falla ahora ante respuestas API 4xx inesperadas
durante la navegación, además de los errores de servidor y JavaScript. El ensayo
de carga exige que se hayan completado sus dos exportaciones para terminar con
éxito; no basta con que las lecturas funcionen.

Verificación: 84 pruebas unitarias, 236 de integración en 16 suites, 110 de
interfaz y 23 de recuperación/programación aprobadas (453 en la batería). Tipos,
lint y compilaciones correctos. Las suites de backend y recuperación están en
`quality/results/20261027T095336Z-300092/`; esa ejecución terminó detectando el
400 de Importaciones. Tras corregirlo, se repitieron tipos, lint, compilación,
las 110 pruebas de interfaz y los recorridos afectados, sin repetir las suites
de backend que no cambiaron. Evidencias finales:
`quality/results/20261027T100221Z-review14-303142/`.

El recorrido aislado pasó doce pantallas y los controles de sesión/origen,
alta/edición/retirada, programación, restauración temporal y reinicio de API y
worker sin duplicar la copia. Una revalidación de carga de 60 segundos completó
ambas exportaciones y una copia concurrente. Las dos auditorías de dependencias
instaladas continúan con cero vulnerabilidades conocidas. La CI remota sigue
pendiente de ejecutarse en GitHub.

Se compararon 14 informes completos del código anterior y el optimizado con
los datos reales, en una transacción `READ ONLY` y un snapshot consistente:
resumen, clientes, finanzas y renovaciones, agrupaciones por día/mes/año y filtros
de clientes activos/inactivos. Coinciden exactamente al excluir únicamente la
marca de generación del informe.

El navegador principal comprobó doce pantallas sin errores JavaScript ni HTTP
4xx inesperados/5xx. Permanecen 2.664 clientes visibles, 2.672 servicios y
operaciones, 23 lotes, 212.620 EUR cobrados y 370 EUR pendientes. Las nueve
tablas de negocio comparadas conservan sus recuentos y hashes antes/después;
las cuatro entradas nuevas de auditoría son los dos inicios y dos cierres de
sesión de esta revisión. El XLSX mantiene su SHA-256, siguen aplicadas las 21
migraciones y no hay esquemas temporales en la base principal. Las copias
automáticas siguen desactivadas. No se detectaron fallos pendientes en estas
comprobaciones; las pruebas finitas no garantizan ausencia absoluta de errores.

### Unificación visual con el dashboard — 27/10/2026

- Paleta compartida en `globals.css`, registrada mediante `@theme inline` de Tailwind 4. Se retira la configuración antigua de Tailwind y la carga duplicada de Inter; la aplicación hereda la fuente de `next/font`.
- Estilos del dashboard disponibles globalmente desde `src/styles/dashboard.css`, junto con `design-system.css`: fondo, paneles, acentos cian/magenta, tipografía, tablas, formularios, estados y foco de teclado comunes a todas las rutas.
- Adaptación de acceso, filtros, tarjetas financieras, auditoría, exportaciones, configuración y fichas. Botones primarios con el degradado del dashboard; acciones destructivas conservan su señal visual roja. Las ventanas tienen altura limitada y desplazamiento interno; los desplegables quedan anclados a su campo.
- Verificación: TypeScript y lint correctos; compilación de producción correcta en un directorio temporal, sin reemplazar `.next` del entorno de desarrollo; 110 pruebas funcionales de UI y dos nuevas pruebas de diseño aprobadas. Estas últimas cubren anchos de 320, 390, 768 y 1440 px, tabla, ventana de cliente, acceso y teclado con datos simulados.
- Navegación real por 14 pantallas principales en escritorio, tableta y móvil, y fichas de clientes, suscripciones, renovaciones y finanzas. Sin desbordamiento horizontal de página ni errores JavaScript/HTTP inesperados en los recorridos. Se mantienen los recuentos de 2664 clientes, 2672 suscripciones y operaciones, 212620 € de ingresos históricos y 370 € pendientes. No se realizan escrituras de negocio durante estos recorridos; los accesos generan su auditoría habitual.
- Incidencia previa observada: `schedule.json` del servicio de recuperación conserva un estado `FALLIDA` registrado el 27/10/2026 a las 13:58 (Madrid), anterior a este cambio visual. La programación permanece desactivada. Este cambio no modifica el servicio, su configuración ni borra el aviso.

#### Revisión adicional del diseño unificado

- Corregida la gestión del foco en las ventanas: diálogo modal nativo, fondo inerte, recorrido de teclado contenido, Escape controlado por el formulario y devolución del foco al botón que abrió la ventana. Se conserva el desplazamiento del contenido y se comprueba que el formulario cabe en pantallas de poca altura.
- Corregidos dos desbordamientos reproducidos: paginación de Auditoría a 320 px y textos largos sin espacios en la ficha de cliente (incluidos tarifa y servidor). Campos móviles de acceso y módulos con tamaño de texto de 16 px.
- La validación de producción detectó una discrepancia de hidratación del calendario al cambiar de día respecto al HTML generado durante la compilación. Ahora la fecha inicial de Madrid se resuelve después de hidratar. Una regresión fija el reloj del navegador al 01/01/2030 en Madrid y verifica fecha, agenda y ausencia de errores React.
- Resultado final: **113 pruebas de interfaz aprobadas sobre la compilación de producción**, TypeScript, lint y build correctos. Se mantienen pruebas explícitas de foco, cierre, fondo inerte, pantallas bajas, textos largos y paginación móvil. Las dos pruebas de calendario que detectaron la discrepancia en producción pasan tras la corrección.
- Recorrido real: 14 pantallas a 320, 390, 768 y 1440 px, cuatro tipos de ficha y apertura/cierre de la ventana de cliente; sin desbordamientos ni errores JavaScript/HTTP inesperados. Recuentos y totales de negocio conservados. La consulta de la política de copias desde el worker funciona; continúa desactivada por defecto y se conserva el aviso histórico documentado anteriormente.
- Evidencia local: `/tmp/k13-review-design-all-ui-final.log`, `/tmp/k13-review-design-build-final.log`, `/tmp/k13-review-design-calendar-check.log` y `/tmp/k13-review-design-browser-final.log`. La producción se compiló y probó en un directorio temporal y puerto interno 3100, sin sustituir el servidor principal.

### Revisión integral — 28–29/10/2026

Correcciones verificadas en `fix/revision-integral-proyecto`, partiendo de `main`
`06581ba`:

- Clientes rechaza con HTTP 400 los identificadores de ruta y `estadoId`
  mal formados, y la edición de `nombre` con `null`, antes de llegar a Prisma.
  Se conserva el vaciado de campos opcionales y la edición parcial.
- Las rutas antiguas de Importaciones validan también los identificadores de
  importación y fila. Diez regresiones detectaron la falta de validación; las
  consultas y revisiones con UUID válidos conservan su contrato.
- El listado y la ficha de Clientes muestran errores recuperables con reintento.
  Al eliminar el último cliente de una página, se vuelve a una página válida.
- El formulario de cliente y la confirmación de borrado bloquean el cierre y
  los envíos repetidos desde el inicio de la acción hasta terminar su promesa.
  La prueba con respuesta retenida detectó que esperar al render de
  `mutation.isPending` dejaba un intervalo en el que Escape cerraba la ventana.
  Las guardias síncronas corrigen ese intervalo; se mantiene Escape inmediatamente
  después de iniciar la petición en las regresiones, sin esperas artificiales.

Resultado: **479 pruebas aprobadas**, desglosadas en 102 unitarias y de validación
HTTP, 236 de integración, 118 de interfaz sobre compilación de producción y
23 de recuperación/programación. Tipos, lint y compilaciones correctos. Las
auditorías de dependencias instaladas de backend y frontend registran cero
vulnerabilidades conocidas.

Las 236 pruebas de integración están en
`quality/results/20261029T010717Z-449952/`. Esa ejecución detectó la carrera del
formulario durante la interfaz; el fallo se corrigió y se revalidó. La evidencia
final de unidades/HTTP, interfaz, recuperación y navegador está en
`quality/results/20261029T011754Z-ui-soak-453520/`, que incluye el ejecutor utilizado,
estado de Git y huellas de las fuentes. Los últimos cambios de backend afectan
solo a la validación de parámetros del controlador y están cubiertos por las
pruebas HTTP nuevas; los servicios de las suites de integración no cambiaron.

El recorrido real aislado completó doce pantallas, controles de sesión y origen,
alta/edición/retirada, programación de una copia, restauración temporal y reinicio
de API/worker sin duplicar la copia. No registró errores JavaScript ni respuestas
HTTP inesperadas. Todas las escrituras de estas pruebas usan datos sintéticos.

Rendimiento comprobado en WSL:

- Escala 10: siete rutas, 637 solicitudes, concurrencias 1/5/10 y respuestas
  correctas. Mayor p95 observado: 696 ms en dashboard. Evidencia:
  `quality/results/20261028T200440Z-429080/benchmark.json`.
- Ensayo final de 300 segundos con diez sesiones: 1460 consultas correctas,
  mayor p95 de 67 ms y máximo de 91 ms. Exportaciones de clientes a XLSX y finanzas
  a CSV legibles, y copia concurrente completada. RSS de API observado entre
  aproximadamente 187 y 240 MiB; conexiones entre 12 y 16. Estas muestras finitas
  no descartan fugas ni sustituyen la observación prolongada en producción.

Integridad del entorno principal: las 21 migraciones coinciden con sus SQL y
checksums; no hay índices inválidos ni restricciones sin validar. Se conservan
los recuentos, importación y finanzas. Ocho de las diez tablas comparadas mantienen
su huella original; las otras dos son suscripciones y actividad. Su diferencia
corresponde exactamente al cambio de día: 14 estados automáticos y 14 recordatorios.
Al reconstruir **solo en memoria** el estado previo de las suscripciones usando
la auditoría, su huella vuelve a coincidir con la original. La comprobación tras
el ensayo final no muestra cambios adicionales en ninguna de las diez tablas.
El XLSX conserva SHA-256
`47e158a3289fededa153b4c6eef30d04e6e7ba4816ed975d85e05a6c98191046`.
Los cuatro servicios principales siguen saludables; se retiraron los recursos
temporales de las pruebas.

La revisión de recuperación comprobó las 19 copias existentes y sus firmas, sin
trabajos pendientes ni mantenimiento activo. La programación principal sigue
desactivada y conserva el aviso histórico `FALLIDA` del 27/10/2026 a las 13:58
(Madrid). La lectura actual de la política funciona; el aviso por sí solo no
prueba una copia fallida y no permite determinar la causa original. Se conserva
para su seguimiento operativo.

La [CI de main](https://github.com/nicolarus05/K13Group/actions/runs/40709081366)
pasó para `06581ba`; las correcciones de esta revisión se validaron localmente
antes de su commit. Se actualizaron los estados documentales de los
sprints 11–14 conforme a las integraciones realizadas. El sprint 15 continúa
pendiente: el entorno Windows/WSL actual es de desarrollo y aún falta el despliegue
definitivo, HTTPS/dominio, monitorización y operación de copias. No se detectaron
más fallos en las comprobaciones descritas; no constituyen una garantía de
ausencia absoluta de errores.

### Navegación y nombre de Contabilidad — 29/10/2026

- Dashboard aparece como primera opción del menú lateral, tanto en escritorio
  como en el menú móvil.
- El nombre visible Finanzas se sustituye por Contabilidad en navegación,
  cabeceras, estadísticas, importaciones e informes e historial de exportación.
- Verificación: 40 pruebas de interfaz aprobadas, comprobación del menú en
  escritorio y móvil, TypeScript de frontend/backend y lint correctos.

## Actualización del XLSX de octubre — 30 de octubre de 2026

- Aplicado `Modelos Funcionales/CLIENTES 2026(Octubre).xlsx`, con 3.208 filas y
  SHA-256 `7fcdfd878b2f8fdb0c53821ab5d5cf229f634dd750b6193691e777f97dfaee26`.
- Importación diferencial `a0b0d592-2bf4-465a-a9c9-69bc8cee14c5` y lote
  `3c081476-1506-4433-8a38-17c4b536547c`: 77 clientes nuevos, 106 fichas
  recuperadas y 183 servicios/operaciones nuevos, incluidos dos gratuitos y
  nueve pendientes de pago. Se conservan los nombres originales y las fichas
  anteriores cuando corresponde; compartir teléfono no fusiona clientes distintos.
- Las 3.010 filas sin cambios conservan su resultado anterior. Diez filas
  actualizan operaciones existentes, sin duplicarlas. Otras cinco no crean
  operaciones: cuatro sin renovación y OCT 260, duplicado confirmado de OCT 107.
  La ausencia de una fila en el nuevo archivo no elimina su histórico.
- Cuatro cobros adicionales de 65 € mantienen intactos los movimientos originales
  de 75 €. El historial muestra ambos cobros y el total de 140 €; las solicitudes
  repetidas no duplican movimientos. La anulación de una operación web comprende
  todos sus movimientos asociados.
- Corregidos los vencimientos, nombres, gratuidades y estados de pago confirmados
  por el usuario. Las fechas históricas siguen la convención de vencimiento menos
  un año. Las correcciones y la correspondencia entre archivos quedan auditadas;
  las 3.135 filas de origen de la importación anterior permanecen intactas.
- Resultado principal verificado: 2.847 clientes visibles, 2.855 servicios,
  2.855 operaciones y 2.850 movimientos; 226.870 € cobrados y 965 € pendientes.
  No quedan filas pendientes de reconciliación en esta actualización; la deuda
  pendiente se conserva expresamente como deuda.
- Copia previa `b26cc518-b75c-41aa-ba3c-1b1a34a592a6`, creada y validada mediante
  restauración temporal antes de aplicar los cambios. Ensayo completo en una base
  aislada, comprobación de reintentos y posterior verificación del entorno principal.
- Validación: 238 pruebas de integración del backend y 119 pruebas de interfaz
  aprobadas. La batería de interfaz se ejecutó secuencialmente para evitar tiempos
  de espera por concurrencia en WSL. Navegador real comprobado en ensayo y en el
  entorno principal: Dashboard, Clientes, Suscripciones, Contabilidad, historial
  de cobros, deuda corregida e importación aplicada, sin errores JavaScript/HTTP 5xx
  ni escrituras de negocio desde las verificaciones web.

## Plantillas de mensajes implementadas — 30 de octubre de 2026

- Botón `Mensajes ▾` en el listado y ficha de clientes y en el detalle de cada
  suscripción. Incluye Cliente Creado, Suscripción Renovada, Demo Creada,
  Suscripción por vencer y Suscripción Vencida.
- `Configuración → Plantillas de mensajes` permite personalizar los cinco textos,
  insertar variables, previsualizar con datos ficticios y recuperar el texto
  inicial. Las ediciones usan versiones y conservan el borrador ante conflictos.
  Los textos personalizados se guardan en claves propias de `configuracion`;
  no se requiere una migración ni se añaden credenciales a las suscripciones.
- Usuario, contraseña y conexiones se introducen únicamente en el preparador del
  mensaje. Se mantienen en el estado local del componente, se descartan al cerrar
  o cambiar de servicio y no se envían a la API ni al almacenamiento del navegador.
  El texto copiado permanece en el portapapeles del dispositivo.
- El cliente, la aplicación y el vencimiento proceden de la ficha y del servicio
  seleccionado. Los importes corresponden a la operación elegida: suma de ingresos
  confirmados y deuda pendiente por separado, excluyendo gastos y anulaciones.
  Un periodo con cobros de 75 € y 65 € muestra 140 €; una deuda PE no figura cobrada.
- Las demos permiten introducir aplicación y vencimiento con fecha y hora de
  Madrid, incluso para clientes sin suscripciones. Preparar mensajes no crea demos,
  servicios, renovaciones ni movimientos financieros.
- Se puede adaptar el texto para un único mensaje, revisar el resultado y copiarlo.
  Las variables pendientes se señalan y bloquean la copia hasta completarlas o
  retirarlas. Si el portapapeles falla, el texto queda seleccionado para copia manual.
- API autenticada; auditoría de cambios de plantilla sin guardar su contenido ni
  mensajes generados. Las consultas de contexto seleccionan expresamente los datos
  permitidos y no exponen identificadores operativos privados.
- Validación: 39 pruebas de backend (mensajes, configuración y seguridad) y 35 de
  interfaz (mensajes, clientes, configuración, renovaciones y suscripciones), todas
  aprobadas. Ensayo adicional con Chromium, API y PostgreSQL aislados: persistencia
  de plantilla, copia real al portapapeles, acceso desde las tres pantallas y demo
  en móvil. Sin errores JavaScript/HTTP 5xx ni cambios en los datos de negocio.
- Comprobación posterior en la aplicación principal: cinco plantillas disponibles,
  desplegable operativo y previsualización de 140 € a partir de dos cobros, sin
  escrituras. Se reinició el backend para retirar un proceso anterior que impedía
  la recarga de las rutas nuevas; todos los servicios quedaron saludables.
- El esquema y la sesión de ensayo se eliminaron al finalizar. El entorno principal
  conserva 2.847 clientes, 2.855 servicios, 2.855 operaciones y 2.850 movimientos,
  con 226.870 € cobrados y 965 € pendientes.

### Revisión de plantillas de mensajes — 30 de octubre de 2026

- Corregida la salida del desplegable con Tab: continúa por las acciones del mismo
  cliente. Al desplazar la lista se cierra el menú y se conserva el foco, sin
  reaccionar a eventos atrasados de desplazamiento o tamaño anteriores a su apertura.
- El menú cabe en pantallas de poca altura y permite recorrer sus opciones por
  teclado sin desplazar la página. Cambiar de servicio vuelve a ocultar la contraseña.
- Los valores compuestos únicamente por espacios se marcan como pendientes. Los
  espacios de credenciales válidas se conservan literalmente; las variables no
  admitidas muestran errores de validación sin bloquear la previsualización del editor.
- Validación posterior: 9 pruebas de integración de mensajes sobre un esquema
  temporal y 40 pruebas de navegador de mensajes, clientes, configuración,
  renovaciones y suscripciones, todas aprobadas. Incluyen cinco casos nuevos de
  regresión y comprueban que un cobro histórico no rellena un periodo actual sin
  operación. TypeScript y ESLint de backend y frontend también aprobados.
- Compilación de producción del frontend aprobada en un directorio temporal con
  `NODE_ENV=production`, eliminado al terminar; no sustituye el servidor de trabajo.
- Comprobación de solo lectura en el entorno principal: permanecen los recuentos
  e importes indicados arriba. Las pruebas no escriben datos de negocio reales.

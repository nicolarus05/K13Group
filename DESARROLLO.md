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

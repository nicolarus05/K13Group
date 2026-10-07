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

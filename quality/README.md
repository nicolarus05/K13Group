# Validación aislada

Requiere Docker Compose v2; se ejecuta desde WSL en el sistema de archivos Linux.
No necesita `.env`, bases, volúmenes ni dependencias del entorno principal.

```bash
./dev quality check
./dev quality browser
./dev quality benchmark
QUALITY_SCALE=10 ./dev quality benchmark
./dev quality soak
```

Cada ejecución compila sus propias imágenes, arranca PostgreSQL desechable y
servidores de producción sin publicar puertos. Los fixtures son sintéticos:
2.664 clientes (incluyen bajas), 2.672 servicios y operaciones, movimientos con
cobros, deuda y gratuidad, referencias, recordatorios y más de 21.000 eventos.
La escala 10 multiplica los registros de negocio. No se carga el XLSX real.
Los identificadores y distribuciones son reproducibles; los estados de vencimiento
se calculan para el día de negocio actual. Los workers normales permanecen activos.

`check` ejecuta auditoría de dependencias (bloquea alertas altas/críticas), tipos,
lint, pruebas unitarias, suites de integración en esquemas separados (incluido el
recálculo de 10.000 suscripciones mientras se consultan clientes), pruebas de
interfaz, recuperación/programación y navegación real de Chromium. Incluye alta,
edición y retirada de un cliente ficticio, programación de una copia real,
restauración temporal y reinicio de API/worker sin duplicar la copia. `browser` ejecuta
la navegación de las doce pantallas y las comprobaciones de sesión y seguridad. El navegador comparte localhost con la API y comprueba
cookies seguras, sesión, origen de escrituras y ausencia de Swagger en producción.
Durante la navegación falla también ante respuestas API 4xx inesperadas.

`benchmark` mide siete consultas HTTP autenticadas con 1, 5 y 10 sesiones
concurrentes: 30 muestras por escenario y una solicitud inicial por ruta. Registra
p50, p95, máximo y tamaño de respuesta, además de planes SQL de auditoría. Conserva
la limitación de peticiones real: cualquier respuesta distinta de 200 hace fallar
el ensayo. No sustituye una prueba prolongada ni mide el rendimiento de escrituras.
Ejecutar sin otras compilaciones o pruebas simultáneas para comparar tiempos.

`soak` mantiene diez sesiones durante cinco minutos, con un máximo aproximado de
cinco peticiones por segundo repartidas entre siete rutas. Registra latencias,
memoria RSS de la API y conexiones a PostgreSQL cada 30 segundos. A los 45 segundos
crea una copia real mientras continúan las lecturas. En ese mismo intervalo
exporta clientes a XLSX y finanzas a CSV y comprueba los archivos recibidos. Se puede ajustar la duración
con `QUALITY_SOAK_SECONDS` entre 60 y 1.800 segundos. No desactiva las protecciones
de acceso ni los límites de peticiones. La estabilidad prolongada debe valorarse
con estas muestras; una medición finita no garantiza ausencia de fugas.

Las evidencias quedan en `quality/results/<ejecución>/` (excluidas de Git), con
versión de Docker, commit, estado de Git, hashes de fuentes presentes, resultados,
logs y recursos antes y
después. El script devuelve error si falla una comprobación y elimina sus propios
contenedores, imágenes y volúmenes al terminar. No elimina recursos del proyecto
principal. Una interrupción forzada del proceso/equipo puede requerir eliminar el
proyecto `k13-quality-<pid>` de esa ejecución manualmente.

El workflow ejecuta `check` en PR y cambios de `main`; las mediciones de ambas
escalas y el ensayo de cinco minutos son opcionales mediante ejecución manual. No usa credenciales reales.

## Dependencias de seguridad

Las imágenes de desarrollo y validación usan Node 22 LTS; Node 20 ya figura fuera
de soporte en el [calendario oficial](https://nodejs.org/en/about/previous-releases).
La actualización mantiene Next 15, con la
[versión corregida 15.5.28](https://github.com/vercel/next.js/releases/tag/v15.5.28).
SheetJS se obtiene de la distribución oficial 0.20.3, con integridad fijada en el
lockfile, siguiendo su [documentación de instalación](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).

Los overrides acotados actualizan dependencias transitivas que sus paquetes padre
todavía fijan a versiones vulnerables: Multer 2.5.0, deepmerge-ts 8.0.2, js-yaml
5.5.0, brace-expansion 1.1.21 y el PostCSS de Next 8.5.26. Su compatibilidad se
comprueba compilando, generando Prisma, aplicando migraciones y ejecutando las
pruebas de archivos, sesión, formularios y exportación. Revisar estos overrides
cuando los paquetes padre incorporen las correcciones.

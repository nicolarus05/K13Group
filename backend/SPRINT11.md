# Sprint 11 — Configuración

Estado: PLANIFICACIÓN COMPLETA, revisada el 08/10/2026. No implementado.
Base: `main`, merge `8f631ec` (entorno WSL y correcciones transversales).
Referencia: módulo funcional Configuracion y plan general en `Modelos Funcionales`.
Las elecciones que se indican como propuestas son decisiones de planificación,
no requisitos previamente confirmados por el usuario.

## Objetivo y resultado esperado

Administrar desde `/configuracion` los ajustes operativos, la cuenta y las copias
manuales. Reutilizar los seis catálogos del sprint 4 y conservar la coherencia con
suscripciones, renovaciones, finanzas, dashboard y recordatorios. Completar el
sprint sin importar el histórico del sprint 3.5.

## Punto de partida verificado

- ConfiguracionController/Service son esqueletos sin endpoints. La navegación
  muestra Configuración como futura. No hay página de configuración.
- Prisma ya contiene Configuracion (clave/valor/descripción), Sesion y
  CopiaSeguridad (archivo/tamaño/estado/fecha). No hay motor de backups.
- `suscripciones.dias_proxima` se lee por separado en suscripciones y
  recordatorios: entero 1–365, valor predeterminado 7. Centralizar esta lectura.
- `seed.catalogos.v1` es una clave interna: no será editable desde la web.
- Catálogos ya tiene CRUD, estados, búsqueda y paginación. Su pestaña actual es
  estado local; añadir navegación por URL para enlazar directamente cada catálogo.
- Las sesiones ya se persisten y revocan. Falta gestionar cuenta, contraseña y
  cierre global. No existe un sistema de roles; el alcance continúa monousuario.
- Entorno Windows + WSL 2 con PostgreSQL 16 y herramientas dentro de Docker.
  Las copias deben sobrevivir a la recreación de contenedores.

## Reglas que se conservan

- EUR, español y Europe/Madrid: visibles, de solo lectura en este sprint.
  Cambiarlos exigiría revisar cálculos, periodos y presentación de todos los módulos.
- Suscripciones anuales. Renovación anticipada desde el vencimiento; tardía desde
  la renovación del servicio. La fecha de cobro nunca altera el periodo.
- No ofrecer la política antigua «renovar desde el pago», superada por el sprint 6.
- Gratis, snapshots, catálogos históricos y fechas/importes existentes se conservan.
- Modificar el umbral puede cambiar el estado efectivo y los avisos abiertos del
  periodo actual. No cambia vencimientos, cobros ni reabre avisos cerrados manualmente.
- No permitir editar secretos JWT, DATABASE_URL, marcas de seed ni claves arbitrarias.

## Trabajo, orden y criterios de aceptación

### 11.1 — Contrato, persistencia y servicio de ajustes

1. Definir una lista cerrada de claves, tipos, valores predeterminados y validaciones.
2. Propuesta de ajustes editables: nombre del negocio (1–150 caracteres), logo
   PNG/JPEG/WebP (máximo 2 MB, validar contenido y dimensiones), umbral de próxima
   renovación (1–365), formato visual de fecha y tamaño de página (10/25/50/100).
   Predeterminados: identidad K13Group actual, 7 días, dd/MM/yyyy y 25 registros.
3. Incorporar versión de edición y fecha de cambio; actualización atómica con
   motivo y auditoría. Conflicto de versión: 409, conservando el borrador de la web.
4. Centralizar lectura tipada; evitar dependencias circulares entre Configuración,
   Suscripciones y Recordatorios. Separar el proveedor de ajustes del controlador.
5. Seed idempotente: añadir valores ausentes sin sobrescribir ajustes del usuario.
   Migración aditiva; nunca ejecutar importación ni cambiar datos financieros.
6. Logo almacenado en un volumen persistente con nombre generado y acceso controlado;
   no SVG/HTML ni rutas proporcionadas por el usuario. Conservar el anterior si falla.

Cierre: API autenticada, rechaza claves desconocidas y valores inválidos; ajustes
persisten tras reiniciar. Escritura y auditoría se revierten juntas ante fallos.

### 11.2 — Interfaz General y conexión con módulos existentes

1. Habilitar `/configuracion`: General, Catálogos, Seguridad, Copias y Sistema.
2. Formularios con carga/error/reintento, estado sin cambios, guardado pendiente,
   confirmación de cambios relevantes y borradores resistentes a refrescos tardíos.
3. Aplicar nombre/logo en la interfaz. Unificar el formato visual de fechas sin
   cambiar contratos ISO ni cálculos de negocio. El tamaño predeterminado solo
   afecta a listas sin elección explícita, respetando sus límites y páginas válidas.
4. Propagar el umbral al estado de suscripciones, seguimiento de renovaciones,
   campana, dashboard y avisos. Invalidar consultas tras guardar. Otras pestañas
   detectarán cambios mediante versión/refresco; no exigir reinicio del backend.
5. Gestionar parámetros técnicos protegidos: intervalo de comprobación de estados/
   avisos (propuesta 1–60 minutos, predeterminado 1), refresco de indicadores
   (15–300 segundos, predeterminado 60), access (5–60 minutos, predeterminado 15)
   y duración máxima de sesión (1–30 días, predeterminado 7). Reautenticación,
   motivo y versión obligatorios. No exponer las claves de firma JWT.
6. Reprogramar workers sin solapamientos ni pérdida del progreso de lotes. Aplicar
   duraciones de tokens a nuevas emisiones y sesiones; informar que las sesiones
   ya creadas conservan su vencimiento absoluto y ofrecer cierre global explícito.
   Un access nuevo no superará el vencimiento de su sesión. Las variables de entorno
   actúan como valores iniciales, no como un segundo origen contradictorio.
7. Cambiar el refresco no cancela formularios ni altera filtros. Pausar las consultas
   de ventanas ocultas según el comportamiento acordado de cada pantalla.

Cierre: un cambio de umbral produce resultados coherentes en todos sus consumidores;
los avisos manualmente cerrados no reaparecen y se conservan los borradores abiertos.

### 11.3 — Acceso a los seis catálogos

1. Enlazar Productos, Tarifas, Servidores, Referencias, Métodos de pago y Categorías
   a las pantallas existentes, con pestaña en URL y navegación atrás/adelante.
2. Reutilizar servicios y componentes, sin crear tablas maestras duplicadas.
3. Mantener invalidación de selectores, filtros y conservación de relaciones históricas.
4. Mostrar en referencias el número de clientes relacionados y un enlace al informe
   de ingresos ya existente, con periodo y atribución histórica explícitos. Contar
   clientes únicos; no sumar importes con lógica distinta de Estadísticas. Enlazar
   suscripciones/clientes relacionados aplicando los filtros necesarios.
5. Orden manual de métodos de pago persistido, versionado y auditado; valores
   iniciales deterministas para registros previos. Reordenación atómica del conjunto,
   desempate estable y propagación a todos los selectores de ingresos y gastos.
6. Revisar observaciones de servidores/referencias frente al modelo real; añadir
   campos opcionales si faltan, con límites y conservación de históricos. Mantener
   el acceso de productos a sus tarifas y las reglas de Gratis.

Cierre: desde Configuración se gestionan los seis catálogos y sus cambios se
reflejan en los formularios de negocio sin duplicar datos o reglas.

### 11.4 — Seguridad de la cuenta

1. Ver perfil y último acceso; editar nombre y username con validación de unicidad.
2. Cambio de contraseña con contraseña actual, nueva y confirmación. Propuesta:
   mínimo 12 caracteres y máximo 72 bytes UTF-8 por el uso actual de bcrypt.
3. Actualizar contraseña y revocar todas las sesiones en una transacción; limpiar
   cookies y volver al login. No almacenar contraseñas/tokens en auditoría o logs.
4. «Cerrar todas las sesiones» con reautenticación y confirmación; incluye la actual.
   Reutilizar Sesion; la duración configurable se resuelve en 11.2.
5. Limitar los intentos de reautenticación en servidor, además del límite general.

Cierre: credenciales erróneas no cambian datos; contraseñas anteriores y tokens
copiados dejan de servir. Auditoría sin secretos y pruebas con dos sesiones reales.

### 11.5 — Copias manuales, descarga y recuperación comprobada

1. Crear/listar/consultar/descargar/eliminar copias mediante API autenticada.
   Reautenticar para descarga, eliminación y restauración. Confirmación de borrado.
2. `pg_dump` en formato custom, limitado a la base de la aplicación y sin roles
   globales. Utilizar cliente PostgreSQL compatible, preferentemente versión 16.
   Resolver primero su disponibilidad en Docker; no depender de binarios de Windows.
3. Volumen dedicado y persistente de backups, fuera del repositorio y del directorio
   público. Registrar checksum, tamaño serializado como string, versión de esquema,
   solicitante y estado. No devolver rutas internas ni detalles de conexión.
4. Trabajo asíncrono persistido: una copia/restauración activa por vez, clave
   idempotente, timeout, límite de tamaño/espacio y recuperación tras reinicio.
   Ampliar CopiaSeguridad o añadir entidad de trabajo, con estados compatibles.
5. Ejecutar procesos con argumentos fijos mediante spawn, sin shell, sin montar el
   socket Docker en la API y sin credenciales en argumentos/logs. Archivos parciales
   no descargables; publicación final atómica. Nunca marcar completada al iniciar.
6. Alcance del respaldo: base de datos y assets configurables como el logo, con
   manifiesto que permita recuperarlos juntos. Las claves y `.env` se custodian
   por separado; la UI no las exporta. La copia contiene datos sensibles.
7. Restauración en dos fases: validar checksum/manifiesto/compatibilidad y restaurar
   primero en una base aislada; verificar migraciones, catálogos, relaciones y
   totales. Solo copias generadas por la aplicación, sin carga arbitraria de dumps.
8. Restauración iniciada desde la web: asistente con copia seleccionada, fecha,
   compatibilidad, resultado de validación, impacto y confirmación escribiendo el
   nombre de la copia. Reautenticación y permiso de ejecución de un solo uso,
   ligados al trabajo y con caducidad. Antes de sustituir la base activa: copia
   previa obligatoria y mantenimiento coordinado con API y workers. Si no se
   puede crear/verificar la copia previa, no se inicia la sustitución.
   Un proceso de recuperación independiente de la API ejecuta la operación y
   comunica su progreso; no mantener abierta una petición HTTP durante el restore.
   `./dev` ofrecerá también recuperación de emergencia si la web no puede arrancar.
9. El registro de recuperación y su manifiesto sobreviven fuera de la base que se
   sustituye. Al restaurar, revocar sesiones recuperadas para no reactivar tokens
   antiguos, reconciliar el inventario de backups y comprobar salud antes de reabrir.
10. Documentar recuperación ante fallo y exportación a almacenamiento externo.
    Un volumen en el mismo equipo no protege frente a pérdida del equipo.

Cierre: generar una copia, descargarla, restaurarla en una base temporal y demostrar
igualdad de datos de negocio; probar dump corrupto, falta de espacio, interrupción,
archivo ausente y doble solicitud. Ensayar sustitución/rollback solo con datos
ficticios aislados. No restaurar la base de trabajo como parte de las pruebas.
Las copias programadas y la retención automática corresponden a sprints 13/15.

### 11.6 — Diagnóstico, regresión y cierre

1. Mostrar estado de BD, versión de aplicación/migraciones y última copia con su
   resultado. Mostrar última importación/exportación solo si existe, sin inventar datos.
2. Historial paginado de cambios de configuración y operaciones de backup;
   el visor global de auditoría sigue en sprint 13.
3. Pruebas API/PostgreSQL aisladas: validación, autenticación, reautenticación,
   concurrencia, rollback, cambios de umbral, backups y revocación de sesiones.
4. Pruebas UI: navegación de catálogos, formularios, errores, datos tardíos,
   conflicto 409, móvil y confirmaciones. Flujo navegador/API real para ajustes,
   seguridad y recuperación en una instalación ficticia.
5. Ejecutar regresiones existentes, tipos, lint y builds mediante `./dev`.
   Partida actual: 18 unitarias, 121 integración y 65 UI; añadir casos según reglas,
   no fijar el número de pruebas como criterio de calidad.
6. Migraciones desde cero y sobre base previa; reinicio sin perder ajustes/assets/copias.
   Actualizar contrato API, modelo funcional, plan y DESARROLLO.md con resultados reales.

## API propuesta

Todas bajo `/api/v1`, autenticadas salvo los endpoints de auth ya existentes.

- `GET /configuracion`: ajustes permitidos, versión y capacidades disponibles.
- `PATCH /configuracion`: valores tipados, versión y motivo; auditoría atómica.
- `POST /configuracion/logo`: carga validada y versionada.
- `GET /configuracion/historial` y `GET /configuracion/sistema`.
- `POST /auth/reauth`, `PATCH /users/me`, `POST /users/me/password`, `POST /auth/logout-all`:
  contratos separados; contraseña actual para las acciones sensibles.
- `GET/POST /configuracion/copias`, `GET /configuracion/copias/:id`.
- `POST /configuracion/copias/:id/descargar|eliminar|validar-restauracion`:
  reautenticación o autorización breve en cuerpo, nunca en URL; operaciones largas devuelven 202 + trabajo.
- `POST /configuracion/copias/:id/restaurar` y `GET /configuracion/trabajos/:id`: solicitud idempotente, prevalidación y seguimiento.
- `PUT /metodos-pago/orden`: lista completa de IDs y versión del conjunto.
- Descargas privadas, sin caché; eliminar archivos por ID controlado, nunca por ruta.

## Dependencias y secuencia

Orden de ejecución: 11.1 (contratos y datos) → 11.4 (reautenticación/cuenta) →
11.2 (ajustes e integración) → 11.3 (catálogos) → 11.5 (backups/restauración) →
11.6 (cierre). La validación acompaña cada bloque, no se pospone toda al final.
La prueba técnica del proceso de recuperación se realiza al principio de 11.5,
antes de diseñar el asistente. No se cierra el sprint si solo funciona desde CLI.
Los límites numéricos propuestos son valores de planificación revisables; no
cambian las reglas de negocio previamente confirmadas.

## Fuera del sprint

Importar el XLSX; exportaciones de negocio Excel/CSV/PDF; roles/multiusuario;
listado de dispositivos; visor global de auditoría; backups programados/remotos;
notificaciones externas; cambio de divisa/idioma/zona horaria; política anual/tardía;
modificación de secretos de infraestructura desde la web;
monitorización productiva y despliegue. La ventana técnica de recuperación no
supone implementar el modo mantenimiento general futuro.

## Definición de terminado

Todos los bloques entregados con los límites de alcance reflejados en la UI
y documentación; ninguna clave interna editable; ninguna modificación de importes
ni fechas históricas; respaldo recuperable demostrado con datos aislados;
regresiones correctas y entorno WSL saludable. El cierre exige resultados medidos,
no basta con declarar disponibles tablas, pantallas o un archivo de copia.

## Diseño de datos y contratos de edición

- Ajustes: catálogo de claves en código; valores persistidos en Configuracion.
  Añadir una revisión global para guardar un formulario completo de forma atómica.
  Respuesta con valores efectivos, revisión, restricciones y fecha de modificación.
  PATCH lleva `{ version, motivo, cambios }`; rechazar el conjunto completo si una
  clave es inválida. La revisión se incrementa solo tras persistencia y auditoría.
- Claves propuestas: `negocio.nombre`, `negocio.logo_asset_id`,
  `interfaz.formato_fecha`, `interfaz.resultados_pagina`,
  `suscripciones.dias_proxima`, `sistema.intervalo_comprobacion_minutos`,
  `interfaz.refresco_indicadores_segundos`, `seguridad.access_minutos` y
  `seguridad.sesion_dias`. Fechas visuales: dd/MM/yyyy o yyyy-MM-dd, sin texto libre.
- El formato y la paginación serán ajustes globales en esta versión monousuario.
  Las selecciones explícitas por pantalla prevalecen; no persistir preferencias
  personales como si fueran configuración global en una futura versión multiusuario.
- Assets: identificador, MIME validado, checksum, tamaño y fecha. Reemplazar el logo
  no borra el archivo que aún utiliza una copia o un trabajo en ejecución.
- Métodos de pago: `orden` y revisión del conjunto; migración inicial conserva un
  orden estable. Inactivos continúan visibles al administrar, no en nuevas asignaciones.
- Copias: ampliar metadatos con manifiesto, checksum, versión de formato,
  migraciones incluidas, solicitante, fecha de finalización y error público seguro.
- Trabajo de copia/recuperación: ID, tipo, clave idempotente, estado, fase, progreso,
  propietario de ejecución, heartbeat y resultado. Propuesta de fases de restore:
  SOLICITADA → VALIDANDO → LISTA → RESPALDO_PREVIO → MANTENIMIENTO → RESTAURANDO →
  VERIFICANDO → COMPLETADA; fallo conduce a FALLIDA o RECUPERANDO_COPIA_PREVIA.
  No reutilizar estados financieros para estos trabajos.
- Los estados de CopiaSeguridad describen el archivo; el estado del trabajo describe
  una ejecución. Restaurar una copia no debe volverla inutilizable para otra validación.
- No insertar credenciales, hashes de contraseñas ni hashes de refresh en snapshots
  de auditoría. Registrar campos modificados, motivo y actor con proyecciones seguras.

## Arquitectura de recuperación para Windows/WSL

1. Introducir un servicio Docker de recuperación independiente del proceso Nest.
   Incluir herramientas PostgreSQL 16, permisos mínimos y un volumen propio de
   backups/trabajos. No montar `/var/run/docker.sock` ni carpetas generales de Windows.
2. La API envía únicamente operaciones de una lista cerrada y referencias de copia.
   El trabajador valida la autorización breve y reclama el trabajo con exclusión
   mutua. Su cola/registro durable debe vivir fuera de PostgreSQL restaurado;
   CopiaSeguridad en la aplicación será una proyección reconciliable del inventario.
3. La confirmación firma una autorización de un solo uso con ID de trabajo, copia,
   checksum, actor y caducidad. No guardar la contraseña de reautenticación en la
   cola. Una clave de recuperación de infraestructura no será editable desde la UI.
4. API y workers consultan el estado de mantenimiento antes de aceptar escrituras.
   Esperar las transacciones iniciadas; no iniciar la sustitución hasta obtener el
   bloqueo exclusivo. Impedir nuevas importaciones, renovaciones y automatismos.
5. La restauración temporal y la sustitución activa usan destinos predeterminados;
   no aceptar nombres de base, rutas o comandos suministrados por el navegador.
   Revisar ownership/extensiones y compatibilidad antes de abrir el dump.
6. Mantener el registro de fases antes y después de cada transición. Tras reinicio,
   detectar trabajo interrumpido y continuar una fase segura o recuperar la copia
   previa. Nunca levantar mantenimiento solo porque se reinició un contenedor.
7. Seguimiento durante la operación mediante credencial de trabajo de alcance
   exclusivo de lectura de estado, sin acceso a dumps o datos. Al completarse se
   exige login nuevo. La recuperación no depende de conservar cookies de la base vieja.
8. Verificar activos, relaciones y migraciones; vaciar las sesiones restauradas,
   reconectar los clientes Prisma y comprobar API antes de reabrir el tráfico.
   Reconstruir en la base el resultado auditado desde el registro externo.
9. `./dev backup`, `./dev restore-check <id>` y `./dev restore <id>` son comandos
   propuestos que invocan el mismo motor, no una segunda implementación. El último
   requiere confirmación explícita, incluso si la web está inaccesible.
10. Probar la recuperación en otro proyecto Compose con puertos/volúmenes distintos.
    No usar `down -v` ni restaurar sobre `k13group_postgres_data` en las pruebas.

La viabilidad del trabajador y el mantenimiento es una dependencia de cierre de
11.5. Si la prueba técnica encuentra una limitación, se revisará la arquitectura;
no se sustituirá silenciosamente el requisito de restauración web por una instrucción manual.

## Matriz de verificación obligatoria

| Área | Casos y evidencia de cierre |
|---|---|
| Ajustes | Límites, claves internas, valores ausentes, dos editores, rollback de auditoría, seed repetible. |
| Identidad visual | Logo válido, falso MIME, archivo excesivo, sustitución fallida, persistencia y recuperación. |
| Umbral | 1/7/365 días, fechas de Madrid, cambio con avisos pendientes/pospuestos/cerrados y suscripciones suspendidas/canceladas. |
| Preferencias | Todas las tablas/paginadores afectados; formato ISO intacto; filtros y borradores conservados. |
| Temporizadores | Cambio en caliente con lote en ejecución, sin dos workers simultáneos ni pérdida del cursor. |
| Catálogos | Enlaces directos, atrás/adelante, orden de pago en formularios, inactivos e históricos conservados. |
| Cuenta | Username duplicado, contraseña actual errónea, bytes UTF-8, dos sesiones, carrera login/cambio de contraseña. |
| Reautenticación | Caducidad, reutilización de permiso, otro actor/trabajo, 429; ningún secreto en logs. |
| Backup | Contenido consistente con escrituras concurrentes, archivos parciales, checksum, falta de espacio, reinicio y doble clic. |
| Descarga/borrado | Autorización, ausencia de caché, archivo ausente, ID/ruta manipulados y borrado concurrente con restore. |
| Restauración | Copia corrupta/incompatible, validación aislada, copia previa fallida, caída por fase y rollback comprobado. |
| Datos recuperados | Clientes, relaciones, importes/fechas, snapshots, logo y ajustes iguales; sesiones revocadas intencionadamente. |
| Operación WSL | UID/GID, PostgreSQL 16, volúmenes persistentes, acceso desde Windows, recreación de contenedores. |
| Regresión | Unitarias, API aislada, UI, recorridos E2E afectados, tipos, lint y compilaciones; fallos documentados y resueltos. |

Para evitar la carrera entre login y cambio de contraseña, ambos deberán coordinar
la comprobación final y la creación/revocación de sesiones sobre el mismo usuario.
No basta con borrar sesiones si un login validado previamente puede crearlas después.

## Entregas revisables y secuencia de commits

1. `feat(configuracion): contratos, migraciones y proveedor tipado` — 11.1 y pruebas.
2. `feat(seguridad): cuenta, reautenticacion y cierre global` — 11.4 y pruebas de carrera.
3. `feat(configuracion): interfaz y propagacion de parametros` — 11.2, sin controles inertes.
4. `feat(catalogos): navegacion, orden y accesos relacionados` — 11.3 y regresiones.
5. `feat(backups): motor persistente, copias y descargas` — primera parte de 11.5.
6. `feat(backups): validacion, restauracion web y recuperacion` — resto de 11.5.
7. `test(configuracion): regresion integral y cierre del sprint` — 11.6 y documentación.

Cada entrega debe compilar y poder probarse independientemente en datos aislados.
Los cambios de esquema se desplegarán antes de habilitar la UI dependiente. La
restauración no se anunciará como disponible hasta completar el ensayo de rollback.
No se fija una fecha de cierre: la mayor incertidumbre está en la recuperación
con sustitución de base y assets; se estimará tras la prueba técnica inicial.

## Revisión final de cobertura del modelo funcional

- General: nombre, logo, preferencias y umbral; EUR/Madrid/español y política anual
  quedan visibles y fijados por las reglas vigentes, no se ofrecen selectores inertes.
- Productos/tarifas, servidores y referencias: mantenimiento reutilizado, observaciones
  cuando proceda, accesos a relaciones e informes y conservación del histórico.
- Métodos de pago y categorías: mantenimiento reutilizado y orden manual incluido.
- Seguridad: perfil, contraseña, último acceso, cierre global e historial del módulo.
- Copias: crear, consultar, descargar, eliminar, validar y restaurar desde la web.
- Sistema: parámetros técnicos protegidos y diagnóstico operativo, incluidos espacio
  disponible para backups y datos de importación/exportación que realmente existan.
- Mejoras expresamente futuras: dispositivos, roles, modo mantenimiento general,
  multidioma, integraciones y notificaciones; no bloquean este sprint.
- Programación/retención automática, auditoría global y operación productiva se
  enlazan con sprints 13/15. La restauración manual y su mantenimiento técnico sí
  forman parte del sprint 11.

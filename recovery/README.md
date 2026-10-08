# Copias y recuperación local

La pantalla **Configuración → Copias** crea, descarga, valida, restaura y elimina
copias manuales. Las operaciones requieren la contraseña actual; restaurar exige
además escribir el identificador de la copia. El progreso sigue disponible durante
el mantenimiento mediante una credencial limitada al trabajo.

El servicio `recovery` contiene PostgreSQL 16 y Python. No depende de ejecutables
Windows ni accede al socket Docker. Comparte con la API dos volúmenes persistentes:
`recovery_data` (archivos, inventario, cola y registro de recuperación) y
`assets_data` (logos). `RECOVERY_SECRET` debe mantenerse en `.env`, fuera de Git.
Conservar esa clave: firma el inventario y las autorizaciones de recuperación.

## Operación desde WSL

```bash
./dev backup
./dev restore-check ID
./dev restore ID            # solicita escribir el ID; sustituye la base de trabajo
./dev recovery-resume      # reinicia el trabajador y recupera operaciones interrumpidas
```

`restore-check` restaura en una base temporal, verifica migraciones y compara las
huellas de las filas. `restore` valida primero, bloquea peticiones y automatismos,
espera operaciones activas y crea/verifica una copia previa. La sustitución y la
revocación de sesiones comparten una transacción. Si falla la comprobación posterior,
recupera la copia previa. Un fallo en esa recuperación mantiene el bloqueo.

Si el equipo o la API se cerraron abruptamente y una restauración informa de
operaciones que no terminan, `./dev recovery-clear-leases` detiene la API, limpia sus
registros de operaciones y la arranca de nuevo. No borrar el archivo `maintenance`
a mano: puede señalar una recuperación pendiente. Tras reparar almacenamiento o
conectividad, ejecutar `./dev recovery-resume` y consultar el resultado del trabajo.

Los trabajos caducan a los cinco minutos antes de iniciar su ejecución. Cada
herramienta PostgreSQL tiene un límite de diez minutos. El máximo predeterminado de
un archivo es 2 GiB y se exige espacio libre antes de generar copias. Solo se acepta
el esquema de migraciones instalado; una actualización de aplicación requiere
conservar también la versión compatible para recuperar una copia anterior.

## Guardar fuera del equipo

Cada descarga es un TAR privado con `database.dump`, `manifest.json` y el logo
referenciado por el snapshot. Comparar el SHA-256 con el mostrado en la pantalla.
El dump excluye sesiones y roles globales; contiene los datos del negocio y las
credenciales de usuario almacenadas en la base. No incluye secretos de `.env`.

Además de las descargas, conservar una exportación de `recovery_data`, con los
archivos `copies/*.json` y `copies/*.tar`, y custodiar `.env` por separado. El motor
usa ese inventario firmado para reconocer y validar las copias; no dispone de una
carga web de archivos externos. Restaurar el volumen y la clave permite usar los
mismos comandos de recuperación en otra instalación compatible. Un volumen Docker
en este equipo no protege frente a pérdida del equipo.

## Verificación reproducible

```bash
./dev test-recovery
./dev test-e2e-configuracion
```

El primer comando crea una base con nombre `k13_recovery_test_<uuid>`, aplica las
migraciones e introduce datos ficticios. Comprueba integridad, sustitución, sesiones,
rollback, reinicio, archivo corrupto/ausente/incompatible y falta de espacio.

El segundo crea el proyecto Compose `k13-sprint11-test`, sin puertos publicados y
con PostgreSQL/volúmenes exclusivos. Chromium realiza login, ajustes, logo,
catálogos, copia, descarga, validación, restauración y cambio de contraseña con la
API real. Después recrea API y trabajador para comprobar persistencia. Al terminar
elimina los recursos de esa instalación de prueba; nunca restaura la base de
trabajo. Las capturas quedan en `/tmp/k13-sprint11-evidence`.

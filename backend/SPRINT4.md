# Sprint 4: catálogos sin importar Excel

Implementado el 15/09/2026: productos, tarifas, servidores, referencias, métodos
de pago y categorías de gasto, disponibles en `/catalogos`. Todos admiten alta,
edición, búsqueda, filtros, ordenación, paginación, desactivación y reactivación.
La API requiere sesión y conserva relaciones históricas con auditoría atómica.

## Preparar una instalación

Desde `backend`, con PostgreSQL y `DATABASE_URL` configurados:

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

El seed básico no lee el XLSX ni importa clientes, suscripciones o movimientos.
Inicializa estados, el usuario de desarrollo y los catálogos base; respeta las
ediciones posteriores mediante `seed.catalogos.v1`. No borres ese marcador para
repetir el seed. Las tarifas y aplicaciones adicionales se crean desde la web.
En nuevas instalaciones DEAD es el único servidor base activo. PA no se interpreta.
En instalaciones existentes se conservan las equivalencias y estados previos.
El usuario inicial de desarrollo debe cambiar su contraseña antes de exponer el
entorno; no se modifica la contraseña de usuarios que ya existan.

La migración `20260915193000_catalogos_gratuitos` añade `esGratuito` y amplía
referencias/snapshots a 150 caracteres. Ya está aplicada en el entorno local.
Al usar Docker, regenerar también Prisma en el contenedor y reiniciar el backend
después de aplicar una migración que cambie el cliente generado.

`prisma/legacy-catalogs.ts` conserva el proceso anterior de lectura del Excel y
normalización de alias, separado del seed. Solo se ejecutaría con la opción explícita
`--confirmar-catalogos-excel`; puede modificar catálogos existentes y NO forma parte
del arranque, el seed ni las pruebas habituales. Sigue aplazado, al igual que la
importación y reconciliación del archivo real.

## Verificación

```sh
npm run lint
npm test -- --runInBand
npm run type-check
npm run build
npm run test:integration
```

`test:integration` crea un esquema aleatorio `catalogos_test_<uuid>` en la base
configurada, aplica las migraciones, usa datos ficticios y elimina únicamente ese
esquema al finalizar. Requiere permisos de creación de esquemas; no debe apuntarse
a producción. La prueba rechaza esquemas no aislados. `npm test` omite esta suite
deliberadamente y ejecuta las dos pruebas unitarias del parser.

Resultado: 19 pruebas de integración y 2 unitarias superadas. Comprueban también
que fallar la auditoría revierte la operación, que los métodos usados no cambian
entre gratuitos y monetarios, y que repetir el seed no altera precios ni estados.
Backend compilado con salida temporal para no interferir con el proceso Docker;
frontend validado mediante `npm run build` desde `frontend`.

Se comprobó la pantalla real en Chrome con respuestas de API simuladas: alta,
edición, desactivación, reactivación, búsqueda y estados vacíos de los seis catálogos
(24 mutaciones simuladas), sin errores JavaScript ni escrituras en datos reales.
Esta comprobación de interfaz complementa las pruebas de API con PostgreSQL;
no equivale a probar un flujo completo de navegador contra la base real.

Lint sin errores, con avisos previos fuera del cambio: 9 imports no usados en
controladores pendientes del backend y 3 usos de `any` en el detalle de clientes.
El sprint 3.5 mantiene pendiente la validación operativa del Excel corregido.

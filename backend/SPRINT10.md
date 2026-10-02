# Sprint 10 — Recordatorios y calendario

Implementación del 02/10/2026. Avisos exclusivamente dentro de la web y siempre
asignados a un cliente, según decisión del usuario. Sin importar XLSX.

## Entrega

- Lista paginada, buscador, filtros de vista/estado/tipo/fechas, alta manual con
  selector de clientes, detalle y auditoría paginada. Gestión con motivo/versión.
- Posponer, completar, cancelar y editar descripción manual, sin modificar la
  suscripción ni confirmar el pago. Acceso a los flujos existentes para hacerlo.
- Campana y dashboard comparten el criterio de atención: RENOVACION pendiente
  hasta hoy + ventana configurada (7 días por defecto); COBRO/contacto hasta hoy;
  POSPUESTO solo desde su nueva fecha. Refresco cada minuto y tras mutaciones.
- Calendario mensual y agenda diaria paginada; una proyección por obligación,
  sin duplicar los avisos automáticos. Incluye renovaciones fuera de la ventana.
  Posponer desplaza seguimiento, no vencimiento; ambos se distinguen en pantalla.
  Un aviso cerrado no borra una obligación aún pendiente del calendario.
- JWT en todas las rutas; GET sin escrituras y proyecciones seguras. El código
  histórico TELEGRAM representa contacto interno: no existe transporte externo.

## Persistencia y concurrencia

Migración aditiva `20261002100000_recordatorios_gestion`: versión, origen,
fecha original, cierre/motivo, updatedAt, UUID/hash de alta y FK al movimiento.
Históricos sin evidencia de automatismo quedan LEGACY. No cambia fechas/importes
de suscripciones, renovaciones o movimientos ni importa datos.

Se conserva el bloqueo transaccional compartido con suscripciones/renovaciones;
alta manual bloquea además su cliente. Alta idempotente y acciones versionadas,
con auditoría dentro de la misma transacción. La clave automática se reserva al
cerrar manualmente para impedir recreación cada minuto. La resolución o cambio
real del origen libera la clave sin reescribir un cierre manual previo.
Renovar/cobrar cierra el aviso; anular cancela el cobro y permite un nuevo aviso
del periodo restaurado. Inactivar/no renovar no borra cobros pendientes.

## API

Prefijo `/api/v1/recordatorios`. GET raíz, `resumen`, `calendario`, `agenda`,
`:id`, `:id/historial`. POST raíz y `:id/editar|posponer|completar|cancelar`.
Contrato y límites en el módulo funcional Recordatorios y Calendario y API REST.
Lista/agenda/historial con pagination; demás con success/data.

## Verificación

Correcciones de la revisión previa al commit:

- Formulario de recordatorios con borrador y versión original independientes
  de los refrescos. Advierte cambios externos, preserva texto/fecha incluso si
  se cierra el aviso y bloquea guardar en ese caso. Descartar y cargar la versión
  actual requiere acción explícita; una recarga fallida no borra el borrador.
- Reajuste de paginación de lista y agenda al desaparecer resultados, sin
  perder filtros. Mismo control compartido con selector de clientes e historial;
  descarta datos de otras páginas o consultas aún en curso para el reajuste.
- Cinco regresiones nuevas de navegador: posponer y editar con respuesta
  tardía/versionado, cierre externo con borrador y reducción/vacío de lista y
  agenda. Las pruebas de borrador fallaban con el código anterior.

Pruebas de integración en esquemas `catalogos_test_<uuid>` descartables, nunca
en public. Cobertura de autenticación/validación, idempotencia/concurrencia,
posposición, terminales no recreados, fechas, calendario sin ventana/paginado,
separación de pagos, cierres por renovación/cobro/anulación y rollback de auditoría.
Pruebas de navegador de filtros, cliente obligatorio, error/reintento, conflicto
y calendario móvil; flujo E2E contra API y PostgreSQL aislados.

Despliegue: `prisma migrate deploy`, `prisma generate` y reinicio de backend;
no ejecutar seed/importación sobre datos reales como parte de este sprint.

### Resultado de la validación local

- 18 pruebas unitarias, 108 de integración y 58 de interfaz: correctas.
  La verificación final de interfaz se ejecutó con
  `node --test --test-concurrency=1 scripts/*-ui.test.cjs`, sin fallos.
- Cinco flujos E2E correctos: recordatorios, renovaciones, finanzas, dashboard
  y estadísticas. Sin errores JavaScript en estos recorridos.
- TypeScript y compilaciones de ambos proyectos: correctos. Lint frontend limpio;
  backend sin errores y con tres advertencias previas de UseGuards sin utilizar
  en los controladores de auditoría, configuración y usuarios.
- Migración aplicada y cliente Prisma regenerado en host/contenedor; backend
  reiniciado. Recuentos antes/después sin cambios: 2 clientes, 0 suscripciones,
  0 renovaciones, 0 movimientos, 0 recordatorios y 0 importaciones en public.
- `git diff --check` sin errores. Cierre del sprint con las dos correcciones
  incluidas; sin importación del XLSX ni publicación remota.

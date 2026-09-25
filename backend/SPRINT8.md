# Sprint 8 — Dashboard

Implementación del 25/09/2026, sin commit ni importación del XLSX.
No necesita migraciones ni genera datos históricos. El logo original se conserva;
su copia pública permite servirlo tanto en Docker como fuera del contenedor.

## Entrega

- Dashboard, sidebar plegable/móvil y cabecera según referencia K13GROUP.
- Ocho indicadores con distinción entre periodo y situación actual; clientes,
  no usuarios administradores. Tabla paginada de clientes y filtros independientes.
- Trabajo pendiente, avisos internos existentes, últimas ocho actividades seguras,
  serie económica diaria y estado del staging (sin exponer filas originales).
- Acciones hacia módulos existentes, alta de cliente y gasto desde el dashboard.
- Refresco cada minuto e invalidación de caché después de guardar. Mutaciones de
  TanStack se observan en el shell; acciones imperativas de suscripciones,
  renovaciones y gastos invalidan explícitamente la clave dashboard.
- Estados de carga, vacío, error/reintento; errores del alta visibles en el modal.

## Contrato y reglas

GET autenticado `/api/v1/dashboard?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.
Ambas fechas o ninguna, inclusive, máximo 366 días. Por defecto mes hasta hoy.
Comparación con ventana consecutiva anterior de igual longitud; base cero es null.
Variación `(actual - anterior) / abs(anterior) * 100`, un decimal.

Clientes con servicio cuentan una vez; suscripciones de clientes activos no
eliminados y estados operativos por fechaFin > hoy de Madrid. No renovar conserva
servicio vigente pero excluye tareas de renovación. Hoy y vencidas son excluyentes.
Renovaciones: COMPLETADA y tipo RENOVACION, no eliminada, por fechaOperacion o
fechaInicio histórica; ALTA/anuladas fuera, gratuitas y pendientes de cobro dentro.

Ingresos/gastos/resultados usan `FinanzasService.balance` con la misma transacción
RepeatableRead. Solo CONFIRMADO, dinero Decimal, fechaCobro o fecha original.
Deudas PENDIENTE de todo el histórico, sin incluirlas en resultado. Serie diaria
rellena ceros, coincide con totales; altas por fecha civil Europe/Madrid.
GET no sincroniza estados ni avisos; no expone credenciales, secretos ni JSON auditado.
Listas resumen limitadas a cinco elementos y actividad a ocho, con agregados SQL.

GET `/api/v1/dashboard/clientes`: page, limit (10 defecto, 100 máximo), search,
estado ACTIVO/INACTIVO. Devuelve proyección pública, total y paginación estable.
Próxima renovación gestionable incluye vencidas; null para clientes inactivos.

## Verificación reproducible

Desde backend, con PostgreSQL local disponible:

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test -- --runInBand --testPathIgnorePatterns=integration.spec.ts
npm run test:integration
npm run test:e2e:dashboard
npm run test:e2e:finanzas
npm run test:e2e:renovaciones
```

Desde frontend:

```sh
npm run lint
npm run build
npm run test:ui
```

Los E2E y tests de integración usan esquemas PostgreSQL temporales validados y
los eliminan al terminar. Ejecutar pruebas con BD secuencialmente, pues los
advisory locks de PostgreSQL se comparten entre esquemas. E2E/UI requieren
frontend en localhost:3000 y Chrome; admiten FRONTEND_TEST_URL y CHROME_PATH.
Las pruebas UI interceptan la API; no escriben en datos de negocio.

Cobertura nueva: fechas/variaciones, JWT/validación, vacíos, estados obsoletos,
clientes únicos, finanzas/serie, Madrid, paginación, privacidad, ausencia de
escrituras GET y staging sintético. Carga: 10.000 movimientos y 1.000 clientes.
UI: escritorio/móvil, logo, menú/foco/Escape, fechas, filtros, alta y errores.
Capturas de revisión visual en /tmp/k13-dashboard-desktop.png y mobile.png.
E2E: dashboard → gasto 25,10 € → deuda 75 € → cobro → resultado 49,90 €,
sin duplicados ni modificaciones del periodo contratado.

## Límites de esta entrega

No incluye estadísticas avanzadas (sprint 9), calendario/envíos (sprint 10),
exportaciones, objetivos ni rediseño del contenido de las otras pantallas.
Los avisos muestran registros existentes; su generación sigue en el worker.
La revisión de posibles duplicados se realiza en Importaciones; el contador
de conflictos no se presenta como si todos fueran duplicados.
No se reconstruyen históricos de estados ni se afirma beneficio fiscal.

## Correcciones tras revisión — 26/09/2026

- Los periodos relativos (hoy, semana, mes y año) se derivan del día actual de
  Madrid. El día se comprueba cada 30 segundos y al recuperar foco/visibilidad,
  incluyendo pestañas suspendidas. Los rangos personalizados y los borradores
  de fechas/formularios no se sobrescriben al cambiar de día.
- Si el total de clientes disminuye, una respuesta válida y terminada del listado
  reajusta la página a la última disponible (mínimo 1). No se utiliza la respuesta
  de otra página ni se corrige durante una consulta en curso.
- Once pruebas nuevas de navegador cubren ambos bugs: cambio de día, semana,
  mes y año, fechas con horario de verano/invierno, recuperación de pestaña,
  conservación de rangos/borradores y reducción del listado hasta quedar vacío.

Verificación posterior: 13 pruebas unitarias, 87 de integración y 34 de interfaz
aprobadas; también los tres E2E (dashboard, finanzas y renovaciones). Build y
tipos correctos. Lint frontend sin advertencias; backend sin errores, con las
cinco advertencias preexistentes de imports sin usar en módulos pendientes.

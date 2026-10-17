'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import type {
  ImportacionFila,
  ImportacionSummary,
  ImportacionFilasResponse,
} from './types/importaciones.types';

const keys: Record<string, string> = {
  FECHA: 'fecha',
  NOMBRE: 'nombre',
  TELEFONO: 'telefonoNormalizado',
  EMAIL: 'email',
  SERVIDOR: 'servidor',
  APP: 'app',
  REFERENCIA: 'referencia',
  PANO: 'importeAnual',
  TOTAL: 'total',
  OBSERV: 'observaciones',
  PAGO: 'pagoClave',
  ESTADO: 'estadoPago',
};
const labels: Record<string, string> = {
  CLIENTE: 'Datos de cliente',
  SUSCRIPCION: 'Suscripción pendiente',
  FINANZAS: 'Pago pendiente',
  AVISO: 'Avisos informativos',
};
const selectClass = 'rounded-input border border-hover bg-background p-2';
const display = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

export function ReadingHistory({
  onSelect,
  disabled,
}: {
  onSelect: (value: ImportacionSummary) => void;
  disabled: boolean;
}) {
  const [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const history = useQuery({
    queryKey: ['importaciones', 'lecturas', page],
    queryFn: () =>
      api
        .get<{ data: ImportacionSummary[]; pagination: { totalPages: number } }>('/importaciones', {
          params: { page, limit: 10 },
        })
        .then((r) => r.data),
  });
  return (
    <details className="rounded-card border-hover border p-4">
      <summary>Retomar un análisis guardado</summary>
      {error && <p role="alert">{error}</p>}
      {history.isPending ? (
        <p>Cargando análisis…</p>
      ) : history.isError ? (
        <p role="alert">
          No se pueden cargar los análisis.{' '}
          <Button onClick={() => void history.refetch()}>Reintentar historial</Button>
        </p>
      ) : (
        <>
          {!history.data.data.length && <p>No hay análisis guardados.</p>}
          {history.data.data.map((item) => (
            <div className="mt-2 flex flex-wrap items-center gap-3" key={item.importacionId}>
              <span>
                {item.archivo} · {item.fechaInicio} · lectura {item.versionMapeo ?? 'anterior'} ·{' '}
                {item.filas} filas
              </span>
              <Button
                disabled={disabled || pending}
                onClick={async () => {
                  setPending(true);
                  setError('');
                  try {
                    const result = await api.get<{ data: ImportacionSummary }>(
                      `/importaciones/${item.importacionId}`,
                    );
                    onSelect(result.data.data);
                  } catch (e) {
                    setError(catalogError(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Abrir análisis
              </Button>
            </div>
          ))}
          <div className="mt-3 flex gap-3">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anteriores
            </Button>
            <Button
              disabled={page >= history.data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Más análisis
            </Button>
          </div>
        </>
      )}
    </details>
  );
}

export function ReadingPreview({
  summary,
  onUpdate,
}: {
  summary: ImportacionSummary;
  onUpdate: (value: ImportacionSummary) => void;
}) {
  const [sheet, setSheet] = useState(''),
    [scope, setScope] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState('');
  const rows = useQuery({
    queryKey: ['importacion', summary.importacionId, 'lectura', sheet, scope, search, page],
    queryFn: () =>
      api
        .get<ImportacionFilasResponse>(`/importaciones/${summary.importacionId}/filas`, {
          params: {
            page,
            limit: 25,
            hoja: sheet || undefined,
            ambito: scope || undefined,
            buscar: search || undefined,
          },
        })
        .then((r) => r.data),
  });
  const row = rows.data?.data.find((r) => r.id === selected) ?? rows.data?.data[0];
  const filter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
    setSelected('');
  };
  return (
    <section className="space-y-5" aria-label="Lectura del Excel">
      <p>
        La lectura está guardada. Puedes corregir datos y retomar la revisión. La creación de
        clientes y operaciones requiere completar las siguientes fases.
      </p>
      <details className="rounded-card border-hover border p-4">
        <summary>Origen y clasificación por hoja</summary>
        <p className="text-xs break-all">
          Archivo: {summary.archivo} · Versión de lectura: {summary.versionMapeo} · SHA-256:{' '}
          {summary.checksum}
        </p>
        {summary.hojas.map((s) => (
          <div key={s.hoja} className="border-hover mt-3 border-t pt-2">
            <strong>
              {s.hoja}: {s.filas} filas de datos · cabecera {s.cabecera ?? 'no reconocida'}
            </strong>
            <p>
              {Object.entries(s.clasificacion ?? {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </p>
            <p>Columnas ausentes: {s.columnasAusentes?.join(', ') || 'ninguna'}</p>
            <p>Columnas adicionales: {s.columnasAdicionales?.join(' · ') || 'ninguna'}</p>
            {s.detalleErrores?.map((e, i) => (
              <p role="alert" key={i}>
                {e}
              </p>
            ))}
          </div>
        ))}
      </details>
      <div className="flex flex-wrap gap-3">
        {Object.entries(summary.bloqueos ?? {}).map(([key, value]) => (
          <span key={key}>
            {labels[key]}: {value} incidencias
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Hoja de origen{' '}
          <select
            className={selectClass}
            value={sheet}
            onChange={(e) => filter(setSheet, e.target.value)}
          >
            <option value="">Todas las hojas</option>
            {summary.hojas.map((s) => (
              <option key={s.hoja}>{s.hoja}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo de incidencia{' '}
          <select
            className={selectClass}
            value={scope}
            onChange={(e) => filter(setScope, e.target.value)}
          >
            <option value="">Todas las incidencias</option>
            {Object.entries(labels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Buscar nombre o teléfono"
          value={search}
          onChange={(e) => filter(setSearch, e.target.value)}
        />
      </div>
      {rows.isPending ? (
        <p role="status">Cargando lectura…</p>
      ) : rows.isError ? (
        <div role="alert">
          No se pueden cargar las filas.{' '}
          <Button onClick={() => void rows.refetch()}>Reintentar lectura</Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="rounded-card border-hover max-h-[600px] overflow-auto border">
              {rows.data.data.length === 0 && (
                <p className="p-4">No hay filas con estos filtros.</p>
              )}
              {rows.data.data.map((item) => (
                <button
                  key={item.id}
                  className={`border-hover block w-full border-b p-3 text-left ${row?.id === item.id ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>{String(item.datosNormalizados.nombre ?? '').trim() || 'Sin nombre'}</strong>
                  <p>
                    {item.hojaOrigen} · fila {item.filaOrigen} ·{' '}
                    {item.lectura?.incidencias.length ?? 0} incidencias
                  </p>
                </button>
              ))}
            </div>
            {row && (
              <div className="min-w-0 space-y-4">
                <h2 className="font-semibold">
                  Lectura de {row.hojaOrigen} · fila {row.filaOrigen}
                </h2>
                <ul className="space-y-2">
                  {row.lectura?.incidencias.map((i, index) => (
                    <li key={index} className="border-hover rounded border p-2 text-sm">
                      <strong>
                        {labels[i.ambito]} ·{' '}
                        {i.celda ? `${row.hojaOrigen}!${i.celda}` : `${i.campo}: columna ausente`}
                      </strong>
                      <p>{i.mensaje}</p>
                    </li>
                  ))}
                </ul>
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        {[
                          'Campo / celda',
                          'Estado',
                          'Original',
                          'Corrección',
                          'Interpretación',
                        ].map((label) => (
                          <th className="p-2" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(row.lectura?.campos ?? {}).map(([key, cell]) => (
                        <tr className="border-hover border-t" key={key}>
                          <th className="p-2">
                            {key} · {cell.celda ?? 'sin columna'}
                          </th>
                          <td className="p-2">
                            {cell.estado}
                            {cell.formula && <p>Resultado de fórmula</p>}
                          </td>
                          <td className="max-w-52 p-2 break-words">{display(cell.valor)}</td>
                          <td className="max-w-52 p-2 break-words">
                            {display(row.correcciones?.[key])}
                          </td>
                          <td className="max-w-52 p-2 break-words">
                            {display(row.datosNormalizados[keys[key]])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Correction
                  key={row.id}
                  row={row}
                  importId={summary.importacionId}
                  onUpdate={onUpdate}
                />
                {!!row.historialLectura?.length && (
                  <details>
                    <summary>Historial de correcciones</summary>
                    <ul className="space-y-3">
                      {row.historialLectura.map((event) => (
                        <li key={event.version} className="border-hover border-t p-2">
                          <strong>
                            Revisión {event.version} · {event.autor}
                          </strong>
                          <p>
                            {event.fecha} · {event.motivo}
                          </p>
                          {Object.entries(event.cambios).map(([key, value]) => (
                            <p key={key}>
                              {key}: {display(event.anteriores[key])} → {display(value)}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span>
              Página {page} · {rows.data.pagination.total} filas
            </span>
            <Button
              disabled={page >= rows.data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Correction({
  row,
  importId,
  onUpdate,
}: {
  row: ImportacionFila;
  importId: string;
  onUpdate: (value: ImportacionSummary) => void;
}) {
  const cache = useQueryClient();
  const [version, setVersion] = useState(row.version),
    [field, setField] = useState('FECHA'),
    [value, setValue] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  return (
    <form
      aria-label="Corregir lectura"
      className="rounded-card border-hover space-y-3 border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError('');
        setNotice('');
        try {
          const result = await api.patch<{ data: ImportacionSummary }>(
            `/importaciones/${importId}/filas/${row.id}/lectura`,
            { version, cambios: { [field]: value.trim() || null }, motivo: reason },
          );
          onUpdate(result.data.data);
          setVersion(version + 1);
          setValue('');
          setReason('');
          await cache.invalidateQueries({ queryKey: ['importacion', importId] });
          setNotice('Corrección guardada y fila revalidada. El original se conserva.');
        } catch (e) {
          setError(catalogError(e));
          void cache.invalidateQueries({ queryKey: ['importacion', importId] });
        } finally {
          setPending(false);
        }
      }}
    >
      <h3 className="font-semibold">Corregir valor de lectura</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {row.version !== version && (
        <p role="alert">
          Hay una revisión más reciente; tu borrador se conserva.{' '}
          <Button
            type="button"
            onClick={() => {
              setVersion(row.version);
              setValue('');
              setReason('');
              setError('');
            }}
          >
            Descartar borrador y usar revisión actual
          </Button>
        </p>
      )}
      <fieldset disabled={pending} className="space-y-3">
        <label>
          Campo que corregir{' '}
          <select
            className={selectClass}
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue('');
              setNotice('');
            }}
          >
            {Object.keys(keys).map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <Input
          label="Valor corregido"
          value={value}
          maxLength={10000}
          onChange={(e) => setValue(e.target.value)}
          hint="Dejar vacío elimina el valor de la lectura; el original se conserva. Fechas: dd/MM/yyyy o yyyy-MM-dd."
        />
        <Input
          label="Motivo de la corrección"
          value={reason}
          required
          minLength={3}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" loading={pending}>
          Guardar corrección
        </Button>
      </fieldset>
    </form>
  );
}

'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { catalogOptions, todayMadrid } from '@/modules/suscripciones/suscripciones.service';
import { selectStyle } from '@/modules/suscripciones/subscription-form';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { finances, type ExpenseInput, type Movement } from './finanzas.service';
export type ExpenseAction = { kind: 'crear' } | { kind: 'editar' | 'anular'; row: Movement };
export function ExpenseDialog({ action, onClose }: { action: ExpenseAction; onClose: () => void }) {
  const row = 'row' in action ? action.row : undefined;
  const cache = useQueryClient();
  const [input, setInput] = useState<ExpenseInput>({
    concepto: row?.concepto ?? '',
    importe: row?.importe ?? '',
    categoriaGastoId: row?.categoriaGastoId ?? '',
    metodoPagoId: row?.metodoPagoId ?? '',
    fecha: (row?.fechaCobro ?? row?.fecha)?.slice(0, 10) ?? todayMadrid(),
    observaciones: row?.observaciones ?? '',
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef({ fingerprint: '', id: '' });
  const options = useQuery({
    queryKey: ['catalogos', 'gastos-options'],
    enabled: action.kind !== 'anular',
    queryFn: async () => ({
      categories: await catalogOptions('categorias-gasto'),
      methods: await catalogOptions('metodos-pago'),
    }),
  });
  const update = (key: keyof ExpenseInput, value: string) =>
    setInput((old) => ({ ...old, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      if (action.kind === 'anular') await finances.annul(action.row.id, action.row.version, reason);
      else if (action.kind === 'editar')
        await finances.update(action.row.id, input, action.row.version, reason);
      else {
        const fingerprint = JSON.stringify(input);
        if (request.current.fingerprint !== fingerprint)
          request.current = { fingerprint, id: crypto.randomUUID() };
        await finances.create(input, request.current.id);
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['finanzas'] }),
        cache.invalidateQueries({ queryKey: ['dashboard'] }),
        cache.invalidateQueries({ queryKey: ['estadisticas'] }),
      ]);
      onClose();
    } catch (err) {
      setError(catalogError(err));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      className="max-h-[90vh] overflow-y-auto"
      open
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title={
        action.kind === 'crear'
          ? 'Nuevo gasto pagado'
          : action.kind === 'editar'
            ? 'Editar gasto'
            : 'Anular gasto'
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <p>Solo gastos generales ya pagados. No se registran comisiones automáticas.</p>
        {error && <p role="alert">{error}</p>}
        {options.isError && action.kind !== 'anular' && (
          <p role="alert">
            No se pudieron cargar los catálogos.{' '}
            <Button type="button" onClick={() => void options.refetch()}>
              Reintentar
            </Button>
          </p>
        )}
        {action.kind !== 'anular' && options.isPending && <p role="status">Cargando catálogos…</p>}
        <fieldset
          disabled={saving || (action.kind !== 'anular' && !options.data)}
          className="space-y-3"
        >
          {action.kind !== 'anular' && (
            <>
              <Input
                label="Concepto"
                required
                maxLength={200}
                value={input.concepto}
                onChange={(e) => update('concepto', e.target.value)}
              />
              <Input
                label="Importe (€)"
                required
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?"
                value={input.importe}
                onChange={(e) => update('importe', e.target.value.replace(',', '.'))}
              />
              <Input
                label="Fecha de pago"
                type="date"
                required
                min="1000-01-01"
                max={todayMadrid()}
                value={input.fecha}
                onChange={(e) => update('fecha', e.target.value)}
              />
              <label className="block">
                Categoría
                <select
                  aria-label="Categoría"
                  required
                  className={selectStyle}
                  value={input.categoriaGastoId}
                  onChange={(e) => update('categoriaGastoId', e.target.value)}
                >
                  <option value="">Selecciona una categoría</option>
                  {options.data?.categories
                    .filter((c) => c.activo || c.id === row?.categoriaGastoId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                        {!c.activo ? ' (inactiva)' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                Método de pago
                <select
                  aria-label="Método de pago"
                  required
                  className={selectStyle}
                  value={input.metodoPagoId}
                  onChange={(e) => update('metodoPagoId', e.target.value)}
                >
                  <option value="">Selecciona un método</option>
                  {options.data?.methods
                    .filter(
                      (m) =>
                        !m.esGratuito && ((m.activo && !m.deletedAt) || m.id === row?.metodoPagoId),
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                        {!m.activo || m.deletedAt ? ' (inactivo)' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <Input
                label="Observaciones"
                maxLength={1000}
                value={input.observaciones}
                onChange={(e) => update('observaciones', e.target.value)}
              />
            </>
          )}
          {action.kind !== 'crear' && (
            <Input
              label="Motivo"
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          {action.kind === 'anular' && (
            <p>
              Se excluirá del balance, conservando su historial. No se realiza una devolución
              bancaria.
            </p>
          )}
          <Button type="submit">{saving ? 'Guardando…' : 'Confirmar'}</Button>
        </fieldset>
        <Button type="button" disabled={saving} onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Modal>
  );
}

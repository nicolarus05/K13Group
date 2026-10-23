'use client';
import { useDateLabel } from '@/modules/configuracion/preferences';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  catalogOptions,
  annualPreview,
  todayMadrid,
  type Subscription,
} from '@/modules/suscripciones/suscripciones.service';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { renewals, type Renewal } from './renovaciones.service';
import { useToast } from '@/components/ui/toast';

export type RenewalAction =
  | { kind: 'renovar' | 'alta' | 'preferencia'; subscription: Subscription }
  | { kind: 'cobrar' | 'anular'; renewal: Renewal };
export function RenewalDialog({ action, onClose }: { action: RenewalAction; onClose: () => void }) {
  const dateLabel = useDateLabel();

  const cache = useQueryClient();
  const toast = useToast();
  const sub = 'subscription' in action ? action.subscription : action.renewal.suscripcion;
  const initial = action.kind === 'alta';
  const financial = ['renovar', 'alta', 'cobrar'].includes(action.kind);
  const [amount, setAmount] = useState(String(sub.tarifa.precio ?? ''));
  const [method, setMethod] = useState('');
  const [pending, setPending] = useState(false);
  const [due, setDue] = useState('');
  const [paid, setPaid] = useState(todayMadrid());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const attempt = useRef({ fingerprint: '', key: '' });
  const methods = useQuery({
    queryKey: ['catalogos', 'metodos-pago', 'renewals'],
    queryFn: () => catalogOptions('metodos-pago'),
    enabled: financial,
  });
  const selected = methods.data?.find((m) => m.id === method);
  const free = Boolean(selected?.esGratuito);
  const options =
    methods.data?.filter(
      (m) => m.activo && !m.deletedAt && (action.kind !== 'cobrar' || !m.esGratuito),
    ) ?? [];
  const end = sub.fechaFin.slice(0, 10);
  const base = end > todayMadrid() ? end : todayMadrid();
  const title =
    action.kind === 'renovar'
      ? 'Renovar suscripción'
      : initial
        ? 'Registrar primer pago'
        : action.kind === 'cobrar'
          ? 'Registrar cobro'
          : action.kind === 'anular'
            ? 'Anular operación'
            : sub.noRenovar
              ? 'Permitir renovación'
              : 'Marcar No renovar';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      if (action.kind === 'preferencia') await renewals.preference(sub, reason);
      else if (action.kind === 'anular')
        await renewals.annul(action.renewal.id, action.renewal.version, reason);
      else if (action.kind === 'cobrar')
        await renewals.collect(action.renewal.id, {
          version: action.renewal.version,
          metodoPagoId: method,
          fechaCobro: paid,
        });
      else {
        const dto = {
          version: sub.version,
          importe: free ? '0' : amount,
          metodoPagoId: method,
          cobro: pending && !free ? ('PENDIENTE' as const) : ('CONFIRMADO' as const),
          ...(!free ? (pending ? { fechaPrevistaCobro: due } : { fechaCobro: paid }) : {}),
          ...(notes.trim() ? { observaciones: notes.trim() } : {}),
          ...(!free && Number(amount) !== Number(sub.tarifa.precio)
            ? { motivoImporte: reason.trim() }
            : {}),
        };
        const fingerprint = JSON.stringify(dto);
        if (attempt.current.fingerprint !== fingerprint)
          attempt.current = { fingerprint, key: crypto.randomUUID() };
        await renewals.create(sub.id, initial, { ...dto, solicitudId: attempt.current.key });
      }
      await Promise.all(
        [
          'renovaciones',
          'suscripciones',
          'clientes',
          'finanzas',
          'dashboard',
          'estadisticas',
          'recordatorios',
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
      toast.success('Operación registrada correctamente.');
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
      open
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title={title}
      size="lg"
    >
      <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
        <p>
          {sub.cliente.nombre} · {sub.producto.nombre}
        </p>
        {(initial || action.kind === 'renovar') && (
          <div className="border-hover rounded border p-3 text-sm">
            <p>Vencimiento actual: {dateLabel(sub.fechaFin)}</p>
            <p>
              Nuevo vencimiento:{' '}
              {initial ? dateLabel(sub.fechaFin) : annualPreview(base, dateLabel)}
            </p>
            <p>
              {initial
                ? 'El primer pago no amplía el periodo inicial.'
                : 'Duración: 12 meses. Se conservan los días pendientes si renuevas antes.'}
            </p>
          </div>
        )}
        {action.kind === 'cobrar' && (
          <p>
            Se confirmará el importe completo de {action.renewal.importe} €. El vencimiento no
            cambia.
          </p>
        )}
        {action.kind === 'anular' && (
          <p className="text-warning">
            Solo se puede anular la última operación compatible. Se anulará su ingreso y se
            restaurará el periodo anterior. Esto no devuelve dinero al cliente.
          </p>
        )}
        {action.kind === 'preferencia' && (
          <p>
            Esta preferencia no cancela el servicio ni perdona cobros pendientes. Es reversible y
            requiere motivo.
          </p>
        )}
        {financial && (
          <>
            {methods.isError && (
              <div role="alert">
                {catalogError(methods.error)}{' '}
                <Button type="button" onClick={() => void methods.refetch()}>
                  Reintentar métodos
                </Button>
              </div>
            )}
            <label className="block text-sm">
              Método de pago
              <select
                aria-label="Método de pago"
                required
                value={method}
                disabled={saving || methods.isPending}
                className="border-hover bg-background mt-1 w-full rounded border p-2"
                onChange={(e) => {
                  setMethod(e.target.value);
                  if (methods.data?.find((m) => m.id === e.target.value)?.esGratuito)
                    setPending(false);
                }}
              >
                <option value="">Seleccionar…</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
            {!methods.isPending && !methods.isError && !options.length && (
              <p>No hay métodos disponibles. Crea o activa uno en Catálogos.</p>
            )}
            {action.kind !== 'cobrar' && (
              <>
                <Input
                  label="Importe (€)"
                  type="number"
                  min={free ? '0' : '0.01'}
                  max="99999999.99"
                  step="0.01"
                  required
                  disabled={saving || free}
                  value={free ? '0' : amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {!free && (
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={pending}
                      disabled={saving}
                      onChange={(e) => setPending(e.target.checked)}
                    />
                    Dejar cobro pendiente
                  </label>
                )}
                {!free && Number(amount) !== Number(sub.tarifa.precio) && (
                  <Input
                    label="Motivo del importe"
                    required
                    minLength={3}
                    maxLength={1000}
                    disabled={saving}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
                {free && <p>Operación gratuita: no se genera ingreso ni deuda.</p>}
              </>
            )}
            {!free &&
              (pending ? (
                <Input
                  label="Fecha prevista de cobro"
                  type="date"
                  min={todayMadrid()}
                  required
                  disabled={saving}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              ) : (
                <Input
                  label="Fecha de cobro"
                  type="date"
                  min={
                    action.kind === 'cobrar'
                      ? action.renewal.fechaOperacion?.slice(0, 10)
                      : initial
                        ? sub.fechaInicio.slice(0, 10)
                        : todayMadrid()
                  }
                  max={todayMadrid()}
                  required
                  disabled={saving}
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              ))}
            {(initial || action.kind === 'renovar') && (
              <Input
                label="Observaciones"
                maxLength={1000}
                disabled={saving}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </>
        )}
        {(action.kind === 'anular' || action.kind === 'preferencia') && (
          <Input
            label="Motivo"
            required
            minLength={3}
            maxLength={1000}
            disabled={saving}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {error && (
          <div role="alert" className="text-danger">
            {error}
            <p className="text-sm">
              El borrador se conserva. Si el registro cambió, cierra el formulario y recarga antes
              de volver a confirmar.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={financial && (!selected || methods.isError || methods.isPending)}
          >
            Confirmar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

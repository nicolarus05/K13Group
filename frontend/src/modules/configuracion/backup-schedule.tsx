'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { fetchSettings, settingsKey, SettingsResponse } from './preferences';

type Status = {
  activa: boolean;
  disponible: boolean;
  ultimaCopia: string | null;
  proxima: string | null;
  estado: string | null;
  error: string | null;
  reintento?: string | null;
};
export function BackupSchedule() {
  const settings = useQuery({ queryKey: settingsKey, queryFn: fetchSettings });
  const status = useQuery({
    queryKey: ['copias-programacion'],
    refetchInterval: 30000,
    queryFn: () =>
      api.get<{ data: Status }>('/configuracion/copias/programacion').then((r) => r.data.data),
  });
  return (
    <section className="k13-surface space-y-3 rounded-card p-5">
      <h2 className="font-semibold">Copias automáticas</h2>
      <p>
        Se guardan en este equipo. Con Windows, WSL o Docker apagados no se pueden ejecutar; al
        volver se crea una sola copia si hay alguna pendiente.
      </p>
      <p>
        La conservación afecta únicamente a copias programadas. Las manuales y las previas a
        restauraciones se conservan.
      </p>
      {(settings.isPending || status.isPending) && <p role="status">Cargando programación…</p>}
      {(settings.isError || status.isError) && (
        <p role="alert">
          No se pudo consultar la programación.{' '}
          <Button
            onClick={() => {
              void settings.refetch();
              void status.refetch();
            }}
          >
            Reintentar programación
          </Button>
        </p>
      )}
      {status.data && (
        <>
          <p>
            {status.data.activa ? 'Programación activada' : 'Programación desactivada'} ·{' '}
            {status.data.disponible ? 'Servicio disponible' : 'Servicio no disponible'}
          </p>
          {status.data.ultimaCopia && (
            <p>
              Última copia programada: {new Date(status.data.ultimaCopia).toLocaleString('es-ES')}
            </p>
          )}
          {status.data.activa && status.data.proxima && (
            <p>
              Próxima:{' '}
              {new Date(status.data.proxima).getTime() <= Date.now()
                ? 'Pendiente de ejecutar cuando el servicio esté disponible'
                : new Date(status.data.proxima).toLocaleString('es-ES')}
            </p>
          )}
          {status.data.error && <p role="alert">{status.data.error}</p>}
          {status.data.activa && status.data.reintento && (
            <p>
              Reintento de la operación: {new Date(status.data.reintento).toLocaleString('es-ES')}
            </p>
          )}
        </>
      )}
      {settings.data && <ScheduleForm initial={settings.data} />}
    </section>
  );
}
function ScheduleForm({ initial }: { initial: SettingsResponse }) {
  const cache = useQueryClient();
  const [base, setBase] = useState(initial);
  const [active, setActive] = useState(initial.valores['copias.automaticas_activas'] === 1);
  const [hours, setHours] = useState(initial.valores['copias.intervalo_horas'] ?? 24);
  const [keep, setKeep] = useState(initial.valores['copias.conservar'] ?? 7);
  const [password, setPassword] = useState(''),
    [reason, setReason] = useState('');
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError('');
        setMessage('');
        try {
          const r = await api.patch<{ data: SettingsResponse }>('/configuracion', {
            version: base.version,
            motivo: reason,
            password,
            cambios: {
              'copias.automaticas_activas': active ? 1 : 0,
              'copias.intervalo_horas': hours,
              'copias.conservar': keep,
            },
          });
          setBase(r.data.data);
          cache.setQueryData(settingsKey, r.data.data);
          await cache.invalidateQueries({ queryKey: ['copias-programacion'] });
          setMessage('Programación guardada.');
          setReason('');
        } catch (err) {
          setError(catalogError(err));
          void cache.invalidateQueries({ queryKey: settingsKey });
        } finally {
          setPassword('');
          setPending(false);
        }
      }}
    >
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {base.version !== initial.version && (
        <p role="alert">
          Los ajustes han cambiado.{' '}
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setBase(initial);
              setActive(initial.valores['copias.automaticas_activas'] === 1);
              setHours(initial.valores['copias.intervalo_horas']);
              setKeep(initial.valores['copias.conservar']);
            }}
          >
            Recargar programación
          </Button>
        </p>
      )}
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <label>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
          Activar copias automáticas
        </label>
        <label className="grid">
          Intervalo en horas
          <input
            className="rounded border p-2"
            type="number"
            min={1}
            max={168}
            required
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <label className="grid">
          Copias programadas que conservar
          <input
            className="rounded border p-2"
            type="number"
            min={1}
            max={90}
            required
            value={keep}
            onChange={(e) => setKeep(Number(e.target.value))}
          />
        </label>
        <label className="grid">
          Motivo de la programación
          <input
            className="rounded border p-2"
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="grid">
          Contraseña para programar
          <input
            className="rounded border p-2"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit">{pending ? 'Guardando…' : 'Guardar programación'}</Button>
      </fieldset>
    </form>
  );
}

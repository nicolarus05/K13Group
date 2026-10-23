'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import { useDateLabel } from './preferences';
type Copy = {
  id: string;
  state: string;
  size: string;
  createdAt: string;
  validatedAt?: string;
  automatic?: boolean;
  checksum: string;
};
type Ticket = { id: string; token: string };
type Job = {
  id: string;
  state: string;
  phase: string;
  action: string;
  error?: string;
  copyId?: string;
};
type Action = 'crear' | 'descargar' | 'eliminar' | 'validar-restauracion' | 'restaurar';
const storageKey = 'k13-recovery-status';
export function Backups() {
  const cache = useQueryClient();
  const dateLabel = useDateLabel();
  const [page, setPage] = useState(1);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [selection, setSelection] = useState<{ action: Action; copy?: Copy } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const saved: unknown = JSON.parse(stored);
        if (
          !saved ||
          typeof saved !== 'object' ||
          !('id' in saved) ||
          !('token' in saved) ||
          typeof saved.id !== 'string' ||
          typeof saved.token !== 'string'
        )
          throw new Error();
        setTicket({ id: saved.id, token: saved.token });
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, []);
  const list = useQuery({
    queryKey: ['configuracion', 'copias', page],
    queryFn: () =>
      api
        .get<{ data: Copy[]; disponible: boolean; pagination: { totalPages: number } }>(
          '/configuracion/copias',
          { params: { page, limit: 10 } },
        )
        .then((r) => r.data),
    refetchInterval: 10000,
    enabled: !ticket,
  });
  const status = useQuery({
    queryKey: ['recovery-status', ticket?.id],
    queryFn: async () => {
      const response = await fetch(`${api.defaults.baseURL}/configuracion/trabajos/${ticket!.id}`, {
        headers: { Authorization: `Bearer ${ticket!.token}` },
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error('No se puede consultar el trabajo. Conserva esta pestaña y reintenta.');
      return (await response.json()).data as Job;
    },
    enabled: !!ticket,
    refetchInterval: (q) =>
      q.state.error || ['COMPLETADA', 'FALLIDA'].includes(q.state.data?.state ?? '') ? false : 1500,
    retry: 1,
  });
  const job = status.data;
  const working = !!ticket && !['COMPLETADA', 'FALLIDA'].includes(job?.state ?? '');
  function choose(action: Action, copy?: Copy) {
    setSelection({ action, copy });
    setPassword('');
    setConfirmation('');
    setError('');
    setRequestId(crypto.randomUUID());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selection) return;
    setPending(true);
    setError('');
    try {
      if (selection.action === 'descargar') {
        const result = await api.post(
          `/configuracion/copias/${selection.copy!.id}/descargar`,
          { password },
          { responseType: 'blob' },
        );
        const url = URL.createObjectURL(result.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `k13-${selection.copy!.id}.tar`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const url =
          selection.action === 'crear'
            ? '/configuracion/copias'
            : `/configuracion/copias/${selection.copy!.id}/${selection.action}`;
        const result = await api.post<{ data: Ticket }>(url, {
          solicitudId: requestId,
          password,
          confirmacion: confirmation,
        });
        setTicket(result.data.data);
        sessionStorage.setItem(storageKey, JSON.stringify(result.data.data));
      }
      setSelection(null);
      setPassword('');
      setConfirmation('');
    } catch (e) {
      setError(catalogError(e));
    } finally {
      setPending(false);
      setPassword('');
    }
  }
  function dismiss() {
    setTicket(null);
    sessionStorage.removeItem(storageKey);
    void cache.invalidateQueries();
  }
  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-semibold">Copias manuales</h2>
        <p className="text-text-secondary text-sm">
          Incluyen la base de datos y el logo. Las claves de infraestructura se custodian por
          separado. Descarga una copia y guárdala fuera del equipo para protegerte ante su pérdida.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {ticket && (
        <div
          className="rounded-card border-primary bg-panel space-y-3 border p-4"
          aria-live="polite"
        >
          <h3>Operación {ticket.id}</h3>
          <p>{job ? `${job.state} · ${job.phase}` : 'Consultando progreso…'}</p>
          {job?.error && (
            <p role="alert" className="text-danger">
              {job.error}
            </p>
          )}
          {status.isError && (
            <div role="alert">
              No se puede consultar el estado.{' '}
              <Button onClick={() => void status.refetch()}>Reintentar estado</Button>
              <p>
                Dejar el seguimiento no cancela la operación. Puedes consultar el resultado en
                Sistema.
              </p>
              <Button onClick={dismiss}>Dejar de seguir esta operación</Button>
            </div>
          )}
          {job?.action === 'restore' && job.state === 'COMPLETADA' ? (
            <p>
              Datos recuperados. Todas las sesiones se han cerrado.{' '}
              <Link
                className="text-primary underline"
                href="/login"
                onClick={() => sessionStorage.removeItem(storageKey)}
              >
                Iniciar sesión
              </Link>
            </p>
          ) : (
            !working && <Button onClick={dismiss}>Volver a las copias</Button>
          )}
        </div>
      )}
      {!ticket && (
        <>
          <Button onClick={() => choose('crear')} disabled={!list.data?.disponible || pending}>
            Crear copia de seguridad
          </Button>
          {list.isPending ? (
            <p role="status">Cargando copias…</p>
          ) : list.isError ? (
            <p role="alert">
              No se pueden cargar las copias.{' '}
              <Button onClick={() => void list.refetch()}>Reintentar</Button>
            </p>
          ) : (
            <>
              {!list.data.disponible && (
                <p role="alert">El servicio de recuperación no está disponible.</p>
              )}
              {!list.data.data.length && <p>No hay copias registradas.</p>}
              <ul className="space-y-4">
                {list.data.data.map((copy) => (
                  <li
                    key={copy.id}
                    className="rounded-card border-hover bg-panel space-y-3 border p-4"
                  >
                    <div className="break-all">
                      <strong>
                        {dateLabel(copy.createdAt)} · {copy.state}
                      </strong>
                      <p>{copy.id}</p>
                      <p>
                        {(Number(copy.size) / 1024 ** 2).toFixed(2)} MB
                        {copy.automatic ? ' · Copia previa de seguridad' : ''}
                      </p>
                      <p>
                        {copy.validatedAt
                          ? `Restauración temporal verificada el ${dateLabel(copy.validatedAt)}`
                          : 'Restauración temporal pendiente'}
                      </p>
                      <details>
                        <summary>Integridad del archivo</summary>
                        <code>{copy.checksum}</code>
                      </details>
                    </div>
                    {copy.state === 'COMPLETADA' && (
                      <div className="flex flex-wrap gap-2">
                        {(
                          ['descargar', 'validar-restauracion', 'restaurar', 'eliminar'] as Action[]
                        ).map((action) => (
                          <Button
                            key={action}
                            variant={
                              action === 'eliminar' || action === 'restaurar'
                                ? 'danger'
                                : 'secondary'
                            }
                            disabled={pending || (!list.data.disponible && action !== 'descargar')}
                            onClick={() => choose(action, copy)}
                          >
                            {
                              {
                                descargar: 'Descargar',
                                'validar-restauracion': 'Validar restauración',
                                restaurar: 'Restaurar',
                                eliminar: 'Eliminar',
                                crear: 'Crear',
                              }[action]
                            }
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <span>Página {page}</span>
                <Button
                  disabled={page >= list.data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {selection && (
        <form
          onSubmit={submit}
          className="rounded-card border-primary bg-panel space-y-4 border p-5"
          aria-label="Confirmar operación de copia"
        >
          <h3 className="font-semibold">
            {selection.action === 'crear'
              ? 'Crear copia'
              : `${selection.action} · ${selection.copy!.id}`}
          </h3>
          {selection.action === 'restaurar' && (
            <>
              <p>
                Se comprobará el archivo y su esquema en una base temporal. Después se bloqueará la
                aplicación, se generará una copia previa obligatoria y se sustituirán los datos. Se
                cerrarán todas las sesiones. Si falla, se intentará recuperar la copia previa.
              </p>
              <p>
                Copia seleccionada: {selection.copy!.createdAt}.{' '}
                {selection.copy!.validatedAt
                  ? 'Validada anteriormente; se volverá a comprobar.'
                  : 'Todavía no validada; se validará antes de sustituir datos.'}
              </p>
              <Input
                label="Escribe el identificador de la copia"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </>
          )}
          {selection.action === 'eliminar' && (
            <p>Se eliminará el archivo de esta copia. Confirma que ya no necesitas recuperarla.</p>
          )}
          <Input
            label="Contraseña actual para esta operación"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-3">
            <Button
              loading={pending}
              disabled={selection.action === 'restaurar' && confirmation !== selection.copy!.id}
              type="submit"
            >
              Confirmar operación
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              type="button"
              onClick={() => {
                setSelection(null);
                setPassword('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

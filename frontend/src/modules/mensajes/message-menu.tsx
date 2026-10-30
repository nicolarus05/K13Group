'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import {
  formatDate,
  formatMoney,
  messages,
  messageTypes,
  renderMessage,
  templateProblems,
  variableLabels,
  type MessageContext,
  type Template,
  type Variable,
} from './messages';

export function MessageMenu({
  clienteId,
  nombre,
  suscripcionId,
}: {
  clienteId: string;
  nombre: string;
  suscripcionId?: string;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [type, setType] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!position) return;
    const anchor = trigger.current?.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node))
        setPosition(null);
    };
    const close = () => {
      if (menu.current?.contains(document.activeElement))
        trigger.current?.focus({ preventScroll: true });
      setPosition(null);
    };
    const scroll = (event: Event) => {
      // El menú puede desplazarse por dentro en pantallas de poca altura.
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      const current = trigger.current?.getBoundingClientRect();
      // Ignorar eventos pendientes del desplazamiento que hizo visible el botón.
      if (!anchor || !current || anchor.top !== current.top || anchor.left !== current.left)
        close();
    };
    const resize = () => {
      if (viewport.width !== window.innerWidth || viewport.height !== window.innerHeight) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [position]);
  function open() {
    if (position) {
      setPosition(null);
      return;
    }
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 256)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 260)),
    });
  }
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        type="button"
        ref={trigger}
        size="sm"
        variant="secondary"
        aria-label={'Mensajes para ' + nombre}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!position) open();
          }
        }}
      >
        Mensajes ▾
      </Button>
      {position &&
        createPortal(
          <div
            id={id}
            ref={menu}
            role="menu"
            aria-label="Plantillas de mensajes"
            className="rounded-card border-hover bg-panel fixed z-[100] max-h-[calc(100dvh-1rem)] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto border p-2 shadow-xl"
            style={position}
            onKeyDown={(e) => {
              const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')],
                index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === 'Escape') {
                e.preventDefault();
                setPosition(null);
                trigger.current?.focus({ preventScroll: true });
              }
              if (e.key === 'Tab') {
                // El portal está al final del documento: retomar el orden de la fila.
                trigger.current?.focus({ preventScroll: true });
                setPosition(null);
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const target =
                  buttons[
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? buttons.length - 1
                        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length
                  ];
                target?.focus({ preventScroll: true });
                if (target) {
                  const container = e.currentTarget;
                  if (target.offsetTop < container.scrollTop)
                    container.scrollTop = target.offsetTop;
                  else if (
                    target.offsetTop + target.offsetHeight >
                    container.scrollTop + container.clientHeight
                  )
                    container.scrollTop =
                      target.offsetTop + target.offsetHeight - container.clientHeight;
                }
              }
            }}
          >
            {messageTypes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="hover:bg-hover focus:bg-hover block min-h-10 w-full rounded px-3 py-2 text-left text-sm"
                onClick={() => {
                  trigger.current?.focus();
                  setPosition(null);
                  setType(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {type && (
        <MessageComposer
          key={clienteId + ':' + type}
          clienteId={clienteId}
          suscripcionId={suscripcionId}
          type={type}
          onClose={() => setType(null)}
        />
      )}
    </span>
  );
}
function MessageComposer({
  clienteId,
  suscripcionId,
  type,
  onClose,
}: {
  clienteId: string;
  suscripcionId?: string;
  type: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ context: MessageContext; template: Template }>();
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([messages.context(clienteId, abort.signal), messages.templates(abort.signal)])
      .then(([context, list]) => {
        if (abort.signal.aborted) return;
        const template = list.plantillas.find((p) => p.tipo === type);
        if (!template) throw new Error('Plantilla no disponible.');
        setLoaded({ context, template });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(catalogError(e));
      });
    return () => abort.abort();
  }, [clienteId, type, attempt]);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="text-left whitespace-normal"
      title={messageTypes.find((t) => t[0] === type)?.[1] ?? 'Mensaje'}
    >
      {loaded ? (
        <MessageForm {...loaded} initialSubscriptionId={suscripcionId} />
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <Button
            onClick={() => {
              setError('');
              setAttempt((n) => n + 1);
            }}
          >
            Reintentar mensaje
          </Button>
        </div>
      ) : (
        <p role="status">Cargando datos del mensaje…</p>
      )}
    </Modal>
  );
}
const fieldClass =
  'block w-full min-w-0 max-w-full rounded-input border border-hover bg-background p-2 text-sm';
function MessageForm({
  context,
  template,
  initialSubscriptionId,
}: {
  context: MessageContext;
  template: Template;
  initialSubscriptionId?: string;
}) {
  const [subId, setSubId] = useState(
    initialSubscriptionId ??
      (context.suscripciones.length === 1 ? context.suscripciones[0].id : ''),
  );
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [body, setBody] = useState(template.texto);
  const [usuario, setUsuario] = useState(''),
    [contrasena, setContrasena] = useState(''),
    [conexiones, setConexiones] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [demoApp, setDemoApp] = useState<string | null>(null),
    [demoDate, setDemoDate] = useState('');
  const [output, setOutput] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [copying, setCopying] = useState(false);
  const outputRef = useRef<HTMLTextAreaElement>(null),
    copyBusy = useRef(false);
  const subscription = context.suscripciones.find((s) => s.id === subId);
  const currentPeriod = subscription?.periodos.find(
    (p) => p.inicio === subscription.inicio && p.vencimiento === subscription.vencimiento,
  );
  const selectedPeriod = subscription?.periodos.find(
    (p) => p.id === (periodId ?? currentPeriod?.id),
  );
  const demo = template.tipo === 'DEMO_CREADA';
  const uses = (key: Variable) => new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}').test(body);
  const validConnections = /^[1-9]\d{0,4}$/.test(conexiones) ? conexiones : '';
  const values = {
    nombre_cliente: context.cliente.nombre,
    usuario,
    contrasena,
    conexiones: validConnections,
    vencimiento: demo
      ? formatDate(demoDate)
      : formatDate(selectedPeriod?.vencimiento ?? subscription?.vencimiento ?? ''),
    aplicacion: demo
      ? (demoApp ?? subscription?.aplicacion ?? '')
      : (selectedPeriod?.aplicacion ?? subscription?.aplicacion ?? ''),
    importe_pagado: demo ? '' : formatMoney(selectedPeriod?.pagado),
    importe_pendiente: demo ? '' : formatMoney(selectedPeriod?.pendiente),
    estado_pago: demo ? '' : (selectedPeriod?.estadoPago ?? ''),
  };
  const rendered = renderMessage(body, values),
    problems = templateProblems(body);
  const invalidate = () => {
    setOutput(null);
    setNotice('');
  };
  async function copy() {
    if (copyBusy.current || output == null || !output.trim() || output.includes('⟦Completar:'))
      return;
    copyBusy.current = true;
    setCopying(true);
    setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(output);
      setNotice('Mensaje copiado.');
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setNotice(
        'No se pudo copiar automáticamente. El texto está seleccionado: usa Ctrl+C o la opción Copiar del dispositivo.',
      );
    } finally {
      copyBusy.current = false;
      setCopying(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="font-medium">{context.cliente.nombre}</p>
      <p className="text-text-secondary text-sm">
        Los datos de acceso se utilizan solo en esta ventana y se descartan al cerrarla. La copia
        permanece en el portapapeles de tu dispositivo.
      </p>
      {context.suscripciones.length > 0 ? (
        <label className="block">
          Suscripción
          <select
            aria-label="Suscripción"
            className={fieldClass}
            value={subId}
            disabled={copying}
            onChange={(e) => {
              setSubId(e.target.value);
              setPeriodId(null);
              setUsuario('');
              setContrasena('');
              setConexiones('');
              setShowPassword(false);
              setDemoApp(null);
              invalidate();
            }}
          >
            <option value="">Selecciona una suscripción</option>
            {context.suscripciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.aplicacion} · {s.servidor} · {formatDate(s.vencimiento)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          Este cliente todavía no tiene suscripciones. Puedes preparar una demo o adaptar el texto.
        </p>
      )}
      {subscription && !demo && (
        <>
          <p className="text-sm">
            Estado actual: {subscription.estado.replaceAll('_', ' ')}. Revisa que el texto
            corresponda a la situación del servicio.
          </p>
          <label className="block">
            Periodo e importes
            <select
              aria-label="Periodo e importes"
              className={fieldClass}
              value={selectedPeriod?.id ?? ''}
              disabled={copying}
              onChange={(e) => {
                setPeriodId(e.target.value);
                invalidate();
              }}
            >
              <option value="">Fechas actuales, sin seleccionar una operación</option>
              {subscription.periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatDate(p.inicio)} — {formatDate(p.vencimiento)} ·{' '}
                  {p.tipo === 'ALTA' ? 'Alta' : 'Renovación'} · {p.estadoPago} ·{' '}
                  {formatMoney(p.pagado) || 'Sin cobro registrado'}
                </option>
              ))}
            </select>
          </label>
          {!selectedPeriod && (
            <p className="text-text-secondary text-sm">
              Selecciona una operación para completar los importes del mensaje.
            </p>
          )}
        </>
      )}
      {demo && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>label]:min-w-0">
          <label>
            Aplicación de la demo
            <input
              className={fieldClass}
              maxLength={100}
              value={demoApp ?? subscription?.aplicacion ?? ''}
              disabled={copying}
              onChange={(e) => {
                setDemoApp(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            Vencimiento de la demo (hora de Madrid)
            <input
              className={fieldClass}
              type="datetime-local"
              value={demoDate}
              disabled={copying}
              onChange={(e) => {
                setDemoDate(e.target.value);
                invalidate();
              }}
            />
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>label]:min-w-0">
        {uses('usuario') && (
          <label>
            Usuario del servicio
            <input
              autoComplete="off"
              className={fieldClass}
              maxLength={250}
              value={usuario}
              disabled={copying}
              onChange={(e) => {
                setUsuario(e.target.value);
                invalidate();
              }}
            />
          </label>
        )}
        {uses('contrasena') && (
          <div>
            <label>
              Contraseña del servicio
              <input
                autoComplete="new-password"
                aria-label="Contraseña del servicio"
                className={fieldClass}
                type={showPassword ? 'text' : 'password'}
                maxLength={500}
                value={contrasena}
                disabled={copying}
                onChange={(e) => {
                  setContrasena(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            </Button>
          </div>
        )}
        {uses('conexiones') && (
          <label>
            Conexiones
            <input
              className={fieldClass}
              type="number"
              min={1}
              max={99999}
              step={1}
              value={conexiones}
              disabled={copying}
              onChange={(e) => {
                setConexiones(e.target.value);
                invalidate();
              }}
            />
          </label>
        )}
      </div>
      <details>
        <summary className="cursor-pointer font-medium">
          Adaptar el texto solo para este mensaje
        </summary>
        <label className="mt-2 block">
          Texto para este mensaje
          <textarea
            aria-label="Texto para este mensaje"
            className={fieldClass}
            rows={8}
            maxLength={10000}
            value={body}
            disabled={copying}
            onChange={(e) => {
              setBody(e.target.value);
              invalidate();
            }}
          />
        </label>
        <p className="text-text-secondary text-sm">Este cambio no modifica la plantilla general.</p>
      </details>
      {problems.map((p) => (
        <p key={p} role="alert">
          {p}
        </p>
      ))}
      {rendered.missing.length > 0 && (
        <p className="text-warning" role="status">
          Falta completar: {rendered.missing.map((k) => variableLabels[k]).join(', ')}. Completa los
          datos o retira esas variables del texto.
        </p>
      )}
      <Button
        type="button"
        disabled={copying || problems.length > 0}
        onClick={() => {
          setOutput(rendered.text);
          setNotice('');
        }}
      >
        Previsualizar mensaje
      </Button>
      {output !== null && (
        <div className="space-y-3">
          <label className="block">
            Mensaje listo para copiar
            <textarea
              ref={outputRef}
              aria-label="Mensaje listo para copiar"
              className={fieldClass}
              rows={13}
              value={output}
              maxLength={20000}
              readOnly={copying}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setOutput(e.target.value);
                setNotice('');
              }}
            />
          </label>
          {output.includes('⟦Completar:') && (
            <p role="alert">Completa o elimina las marcas pendientes antes de copiar.</p>
          )}
          <Button
            type="button"
            disabled={copying || !output.trim() || output.includes('⟦Completar:')}
            onClick={() => void copy()}
          >
            Copiar mensaje
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

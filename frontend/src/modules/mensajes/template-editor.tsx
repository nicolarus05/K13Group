'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { catalogError } from '@/modules/catalogos/services/catalogos.service';
import {
  messages,
  renderMessage,
  sampleValues,
  templateProblems,
  variableLabels,
  type Template,
  type TemplateList,
} from './messages';
const area = 'w-full rounded-input border border-hover bg-background p-3 text-sm';
export function TemplateEditor() {
  const [data, setData] = useState<TemplateList>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    messages
      .templates(abort.signal)
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(catalogError(e));
      });
    return () => abort.abort();
  }, [attempt]);
  if (!data)
    return (
      <div>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              onClick={() => {
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              Reintentar plantillas
            </Button>
          </>
        ) : (
          <p role="status">Cargando plantillas…</p>
        )}
      </div>
    );
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Plantillas de mensajes</h2>
      <p className="text-text-secondary">
        Personaliza los textos generales e inserta variables. Los datos concretos de acceso se
        completan al preparar cada mensaje.
      </p>
      {data.plantillas.map((template) => (
        <Editor key={template.tipo} initial={template} />
      ))}
    </section>
  );
}
function Editor({ initial }: { initial: Template }) {
  const [saved, setSaved] = useState(initial),
    [text, setText] = useState(initial.texto);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [remote, setRemote] = useState<Template>();
  const ref = useRef<HTMLTextAreaElement>(null),
    pending = useRef(false);
  const problems = templateProblems(text);
  async function save() {
    if (pending.current || problems.length) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await messages.save(saved, text);
      setSaved(result);
      setRemote(undefined);
      setNotice('Plantilla guardada.');
    } catch (e) {
      setError(catalogError(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await messages.templates();
      setRemote(result.plantillas.find((p) => p.tipo === saved.tipo));
    } catch (e) {
      setError(catalogError(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function insert(key: string) {
    const field = ref.current,
      start = field?.selectionStart ?? text.length,
      end = field?.selectionEnd ?? start;
    const token = '{{' + key + '}}';
    setText(text.slice(0, start) + token + text.slice(end));
    setNotice('');
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  return (
    <details className="rounded-card border-hover bg-panel border p-4">
      <summary className="cursor-pointer font-semibold">{saved.nombre}</summary>
      <div className="mt-4 space-y-3">
        <label className="block">
          Texto de {saved.nombre}
          <textarea
            ref={ref}
            aria-label={'Texto de ' + saved.nombre}
            className={area}
            rows={10}
            maxLength={10000}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setNotice('');
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2" aria-label={'Variables para ' + saved.nombre}>
          {Object.entries(variableLabels).map(([key, label]) => (
            <Button
              type="button"
              key={key}
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => insert(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        {problems.map((p) => (
          <p role="alert" key={p}>
            {p}
          </p>
        ))}
        <p className="font-medium">Vista previa con datos ficticios</p>
        <pre className="border-hover rounded border p-3 text-sm break-words whitespace-pre-wrap">
          {renderMessage(text, sampleValues).text}
        </pre>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || problems.length > 0 || text === saved.texto}
            onClick={() => void save()}
          >
            Guardar plantilla
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setText(saved.textoInicial);
              setNotice('Texto inicial cargado en el editor. Pulsa Guardar para aplicarlo.');
            }}
          >
            Usar texto inicial
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
            Consultar versión guardada
          </Button>
        </div>
        {remote && (
          <div className="border-hover space-y-2 rounded border p-3">
            <p>Versión guardada: {remote.version}. Tu borrador sigue en el editor.</p>
            <pre className="text-sm break-words whitespace-pre-wrap">{remote.texto}</pre>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => {
                setSaved(remote);
                setText(remote.texto);
                setRemote(undefined);
                setError('');
                setNotice('Versión guardada cargada.');
              }}
            >
              Cargar versión guardada
            </Button>{' '}
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => {
                setSaved(remote);
                setRemote(undefined);
                setError('');
                setNotice('Borrador conservado sobre la nueva versión. Revisa y guarda.');
              }}
            >
              Conservar mi borrador sobre esta versión
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

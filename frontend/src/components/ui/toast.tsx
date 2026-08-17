'use client';

import { createContext, useCallback, useContext, useReducer, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastType, ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const styles: Record<ToastType, string> = {
  success: 'border-success/30 text-success',
  error: 'border-danger/30 text-danger',
  warning: 'border-warning/30 text-warning',
  info: 'border-primary/30 text-primary',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(
    (state: Toast[], action: { type: 'add'; payload: Toast } | { type: 'remove'; id: string }) => {
      if (action.type === 'add') return [...state, action.payload];
      return state.filter((t) => t.id !== action.id);
    },
    [],
  );

  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);

  const toast = useCallback(
    (opts: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID();
      dispatch({ type: 'add', payload: { ...opts, id } });
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const ctx: ToastContextValue = {
    toast,
    success: (title, description) => toast({ type: 'success', title, description }),
    error: (title, description) => toast({ type: 'error', title, description }),
    warning: (title, description) => toast({ type: 'warning', title, description }),
    info: (title, description) => toast({ type: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Contenedor de toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => {
          const Icon = icons[t.type];
          return (
            <div
              key={t.id}
              className={cn(
                'flex w-80 items-start gap-3 rounded-card border bg-panel px-4 py-3 shadow-lg',
                styles[t.type],
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-main">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs text-text-secondary">{t.description}</p>
                )}
              </div>
              <button onClick={() => remove(t.id)} className="shrink-0 text-text-secondary hover:text-text-main">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}

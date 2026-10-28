'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  className?: string;
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Native modal semantics make the background inert. Preserve focus and
    // scrolling explicitly because React can remove the dialog before cleanup.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scroller = dialog.closest<HTMLElement>('.k13-main') ?? document.body;
    const previousOverflow = scroller.style.overflow;
    scroller.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      scroller.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // The caller can prevent dismissal while a save is in progress.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
      className={cn(
        'k13-modal k13-surface rounded-modal text-text-main fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto p-0 shadow-xl',
        sizes[size],
        className,
      )}
    >
      {(title || description) && (
        <div className="border-hover border-b px-6 py-4 pr-14">
          {title && (
            <h2 id={titleId} className="text-text-main text-base font-semibold">
              {title}
            </h2>
          )}
          {description && (
            <p id={descriptionId} className="text-text-secondary mt-0.5 text-sm">
              {description}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-text-secondary hover:bg-hover hover:text-text-main absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded transition-colors"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="p-6">{children}</div>
    </dialog>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  loading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  loading,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-button border-hover text-text-secondary hover:bg-hover border px-4 py-2 text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="k13-action-danger rounded-button px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

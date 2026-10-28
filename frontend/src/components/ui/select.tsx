'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar…',
  label,
  error,
  disabled,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Cerrar al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectId = label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className={cn('relative space-y-1', className)} ref={ref}>
      {label && (
        <label htmlFor={selectId} className="text-text-secondary block text-sm font-medium">
          {label}
        </label>
      )}

      <button
        id={selectId}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'rounded-input bg-background flex w-full items-center justify-between border px-3 py-2 text-sm transition-colors',
          error ? 'border-danger' : open ? 'border-primary' : 'border-hover',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          selected ? 'text-text-main' : 'text-text-secondary',
        )}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cn('text-text-secondary h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="rounded-input border-hover bg-panel absolute z-20 mt-1 max-h-64 w-full overflow-y-auto border shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                opt.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-hover',
                opt.value === value ? 'text-primary' : 'text-text-main',
              )}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  opt.value === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

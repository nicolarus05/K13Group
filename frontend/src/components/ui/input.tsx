import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="text-text-secondary block text-sm font-medium">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={cn(
            'rounded-input bg-background text-text-main w-full border px-3 py-2 text-sm transition-colors outline-none',
            'placeholder:text-text-secondary/70',
            error ? 'border-danger focus:border-danger' : 'border-hover focus:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {error && <p className="text-danger text-xs">{error}</p>}
        {hint && !error && <p className="text-text-secondary text-xs">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';

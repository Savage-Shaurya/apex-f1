'use client';

import { cloneElement, isValidElement, useId, type ComponentPropsWithoutRef, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Icon } from './Icon';

/**
 * Form fields follow the original spec: an underline that turns red and
 * thickens on focus. Labels are always visible; hints and errors are tied
 * to the control with aria-describedby; errors say what to do.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // The control's own describedby/invalid (a live status line, a server error) are kept, not replaced.
  const own = isValidElement(children) ? children.props : {};
  const describedBy = [hintId, errorId, own['aria-describedby']].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : own['aria-invalid'] })
    : children;
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={id} className="font-text text-small font-[650] text-fg">
        {label}
        {optional && <span className="ml-2 font-normal text-fg-3">Optional</span>}
      </label>
      {control}
      {hint && <p id={hintId} className="font-text text-caption text-fg-3">{hint}</p>}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 font-text text-small text-accent">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full min-h-12 bg-transparent px-0 py-2.5 font-text text-body text-fg placeholder:text-fg-3 shadow-[inset_0_-1px_0_var(--control-edge)] transition-shadow duration-[var(--duration-fast)] focus:outline-none focus:shadow-[inset_0_-3px_0_var(--color-brand-red)] aria-invalid:shadow-[inset_0_-3px_0_var(--accent-text)] disabled:opacity-50';

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(CONTROL, className)} {...rest} />;
}

export function Textarea({ className, rows = 5, ...rest }: ComponentPropsWithoutRef<'textarea'>) {
  return <textarea rows={rows} className={cn(CONTROL, 'resize-y leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentPropsWithoutRef<'select'>) {
  return (
    <span className="relative block">
      <select className={cn(CONTROL, 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-fg-2" />
    </span>
  );
}

/** Checkbox: the box itself is 24px (WCAG 2.5.8) and the whole 44px-tall label row is the hit area. */
export function Checkbox({ label, description, className, ...rest }: { label: ReactNode; description?: ReactNode; className?: string } & Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'className'>) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className={cn('flex min-h-11 cursor-pointer items-start gap-3 py-2', className)}>
      <span className="relative flex size-6 shrink-0">
        <input id={rest.id ?? id} type="checkbox" className="peer size-6 cursor-pointer appearance-none bg-transparent shadow-[inset_0_0_0_1.5px_var(--control-edge)] checked:bg-brand-red checked:shadow-none" {...rest} />
        <Icon name="check" size={18} strokeWidth={2.5} className="pointer-events-none absolute inset-[3px] text-white opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="min-w-0">
        <span className="block font-text text-ui text-fg">{label}</span>
        {description && <span className="mt-0.5 block font-text text-caption text-fg-3">{description}</span>}
      </span>
    </label>
  );
}

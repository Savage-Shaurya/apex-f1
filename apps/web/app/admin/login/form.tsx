'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ds';
import { USERNAME_PATTERN } from './username-pattern';

export function AdminLoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setMessage('');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ username: fields.get('username'), password: fields.get('password'), otp: fields.get('otp') }), signal: controller.signal });
      const result: unknown = await response.json();
      if (response.ok && result && typeof result === 'object' && 'ok' in result && result.ok === true) {
        form.reset(); router.replace('/admin'); router.refresh(); return;
      }
      setMessage(response.status === 429 ? 'Too many attempts. Wait five minutes before trying again.' : response.status === 503 ? 'Sign in is temporarily unavailable. Please try again shortly.' : 'Sign in could not be accepted. Check your details and use a fresh authenticator code.');
    } catch { setMessage('Sign in could not be confirmed. Use a fresh authenticator code to try again.'); }
    finally {
      clearTimeout(deadline);
      // Secrets never linger in the form after an attempt.
      for (const name of ['password', 'otp']) {
        const input = form.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = '';
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-6" aria-busy={busy}>
      <Field label="Username" hint="Lowercase letters, numbers, dots, hyphens or underscores.">
        <Input name="username" autoComplete="username" required maxLength={64} pattern={USERNAME_PATTERN} autoCapitalize="none" spellCheck={false} disabled={busy} />
      </Field>
      <div className="relative">
        <Field label="Password">
          <Input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={512} disabled={busy} className="pr-20" />
        </Field>
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-pressed={showPassword}
          className="absolute bottom-0 right-0 min-h-12 px-2 font-text text-small font-[650] text-fg-2 hover:text-fg"
        >
          {showPassword ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
        </button>
      </div>
      <Field label="Authenticator code" hint="The six digits currently shown in your authenticator app.">
        <Input name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} disabled={busy} className="font-timing tracking-[0.3em]" />
      </Field>
      <Button type="submit" size="lg" block loading={busy}>Sign in</Button>
      <p role="status" aria-live="polite" className="min-h-6 font-text text-small text-accent">{message}</p>
    </form>
  );
}

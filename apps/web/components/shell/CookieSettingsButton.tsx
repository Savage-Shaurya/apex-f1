'use client';

export function CookieSettingsButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event('apex:open-consent'))}
    >
      Cookie preferences
    </button>
  );
}

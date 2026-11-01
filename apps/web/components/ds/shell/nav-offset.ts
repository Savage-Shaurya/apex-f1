/**
 * Sticky sub-bars sit under the fixed header through `--nav-offset` (globals.css), which drops to
 * 0 while the header is hidden via html[data-nav-hidden]. Changing an inherited custom property on
 * <html> restyles every element on the page (12-38 ms per toggle at CPU x4 on Home, audit HNV-6),
 * so the state is only written on pages that have a reader: an element whose class names the
 * variable (Tailwind keeps it in the class: `top-[var(--nav-offset)]`).
 */
export const NAV_OFFSET_USERS = '[class*="nav-offset"]';

export function syncNavOffset(doc: Pick<Document, 'documentElement' | 'querySelector'>, hidden: boolean): void {
  const data = doc.documentElement.dataset;
  if (doc.querySelector(NAV_OFFSET_USERS)) {
    data.navHidden = hidden ? 'true' : 'false';
    return;
  }
  // No reader: leave <html> alone (absent means shown); clear a state a previous page left.
  if (data.navHidden !== undefined) delete data.navHidden;
}

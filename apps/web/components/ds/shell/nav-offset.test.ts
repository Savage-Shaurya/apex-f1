import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NAV_OFFSET_USERS, syncNavOffset } from './nav-offset';

function fakeDoc(users: boolean) {
  const dataset: Record<string, string | undefined> = {};
  let writes = 0;
  const root = { dataset: new Proxy(dataset, { set: (t, k, v) => { writes++; t[k as string] = v; return true; }, deleteProperty: (t, k) => { writes++; delete t[k as string]; return true; } }) };
  return { doc: { documentElement: root, querySelector: (sel: string) => (sel === NAV_OFFSET_USERS && users ? {} : null) } as unknown as Document, dataset, writes: () => writes };
}

test('a page with sticky sub-bars gets the header state on <html>', () => {
  const f = fakeDoc(true);
  syncNavOffset(f.doc, true);
  assert.equal(f.dataset.navHidden, 'true');
  syncNavOffset(f.doc, false);
  assert.equal(f.dataset.navHidden, 'false');
});

test('a page without any --nav-offset reader never touches <html> (a full-page style recalc per toggle, audit HNV-6)', () => {
  const f = fakeDoc(false);
  syncNavOffset(f.doc, true);
  syncNavOffset(f.doc, false);
  syncNavOffset(f.doc, true);
  assert.equal(f.writes(), 0);
  assert.equal(f.dataset.navHidden, undefined);
});

test('a stale hidden state left by a previous page is cleared once', () => {
  const f = fakeDoc(false);
  f.dataset.navHidden = 'true';
  syncNavOffset(f.doc, true);
  assert.equal(f.dataset.navHidden, undefined);
});

test('every sticky sub-bar reads the offset through a class name the selector matches', () => {
  // Tailwind arbitrary values keep the variable name in the class: top-[var(--nav-offset)].
  assert.equal(NAV_OFFSET_USERS, '[class*="nav-offset"]');
});

test('review 2026-11-01: a route change re-syncs the header state, so sticky bars on the new page are not one header-height low', async () => {
  const { readFileSync } = await import('node:fs');
  const header = readFileSync(new URL('./SiteHeader.tsx', import.meta.url), 'utf8');
  // An effect keyed on the pathname shows the header and writes that state for the new page.
  const effect = header.match(/useEffect\(\(\) => \{\n(?:(?!useEffect\()[\s\S])*?syncNavOffset\(document, false\);\n\s*\}, \[pathname, isFixed\]\);/);
  assert.ok(effect, 'SiteHeader syncs the nav offset when the pathname changes');
  assert.match(effect[0], /f\.hidden = false;/);
  // And the sync itself writes on a page with readers even when the previous page had none.
  const f = fakeDoc(true);
  syncNavOffset(f.doc, false);
  assert.equal(f.dataset.navHidden, 'false');
});

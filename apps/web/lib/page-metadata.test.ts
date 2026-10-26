import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withSocial } from './page-metadata';

test('R3-REG-2: per-page og/twitter title, description and url come from the page itself', () => {
  const meta = withSocial({ title: 'Fernando Alonso: Formula 1 driver profile', description: 'Career record.', alternates: { canonical: '/drivers/alonso' } });
  const og = meta.openGraph as Record<string, unknown>;
  const tw = meta.twitter as Record<string, unknown>;
  assert.equal(og.title, 'Fernando Alonso: Formula 1 driver profile · Apex');
  assert.equal(og.description, 'Career record.');
  assert.equal(og.url, '/drivers/alonso');
  assert.equal(og.siteName, 'Apex');
  assert.equal(tw.title, 'Fernando Alonso: Formula 1 driver profile · Apex');
  assert.equal(tw.description, 'Career record.');
  assert.deepEqual(meta.alternates, { canonical: '/drivers/alonso' });
});

test('R3-REG-2: a page that sets its own openGraph keeps it; absolute titles are not suffixed', () => {
  const meta = withSocial({ title: { absolute: 'Apex' }, alternates: { canonical: '/' }, openGraph: { type: 'article', title: 'Story' } });
  const og = meta.openGraph as Record<string, unknown>;
  assert.equal(og.type, 'article');
  assert.equal(og.title, 'Story');
  assert.equal(og.url, '/');
  assert.equal((meta.twitter as Record<string, unknown>).title, 'Apex');
  assert.deepEqual(withSocial({}), {});
});

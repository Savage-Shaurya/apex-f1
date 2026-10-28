import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy, posthogResourceOrigin } from '../lib/security-headers';

function directives(policy: string) { return new Map(policy.split('; ').map(part => { const [name, ...values] = part.split(' '); return [name!, values]; })); }
test('production scripts, connections, fonts and frames have explicit supported resource boundaries', () => {
  const policy = directives(contentSecurityPolicy({ NODE_ENV: 'production' }));
  assert.deepEqual(policy.get('default-src'), ["'self'"]);
  assert.deepEqual(policy.get('object-src'), ["'none'"]);
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(policy.get('frame-src'), ['https://www.youtube-nocookie.com', 'https://www.youtube.com']);
  assert.deepEqual(policy.get('font-src'), ["'self'", 'data:']);
  assert.ok(policy.get('script-src')?.includes("'unsafe-inline'"), 'Required current Next hydration remains explicit');
  for (const name of ['script-src', 'connect-src']) {
    assert.equal(policy.get(name)?.includes('https:'), false);
    assert.equal(policy.get(name)?.some(value => value.includes('*')), false);
    assert.equal(policy.get(name)?.includes("'unsafe-eval'"), false);
    assert.equal(policy.get(name)?.includes('ws:'), false);
  }
  assert.deepEqual(policy.get('img-src'), ["'self'", 'data:', 'blob:', 'https:'], 'Publisher CDNs are intentionally allowed over HTTPS');
});
test('development alone permits React debugging evaluation and WebSocket HMR', () => {
  const policy = directives(contentSecurityPolicy({ NODE_ENV: 'development' }));
  assert.ok(policy.get('script-src')?.includes("'unsafe-eval'"));
  assert.ok(policy.get('connect-src')?.includes('ws:')); assert.ok(policy.get('connect-src')?.includes('wss:'));
  for (const environment of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'unknown' }, { NODE_ENV: 'development', VERCEL: '1' }, { NODE_ENV: 'development', VERCEL_ENV: 'preview' }]) {
    const restricted = directives(contentSecurityPolicy(environment));
    assert.equal(restricted.get('script-src')?.includes("'unsafe-eval'"), false);
    assert.equal(restricted.get('connect-src')?.includes('ws:'), false);
  }
});
test('explicit analytics hosting adds only its canonical origin and invalid values never become policy tokens', () => {
  assert.equal(posthogResourceOrigin(undefined), 'https://app.posthog.com');
  assert.equal(posthogResourceOrigin('https://analytics.apex.example/'), 'https://analytics.apex.example');
  const policy = directives(contentSecurityPolicy({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_HOST: 'https://analytics.apex.example' }));
  assert.ok(policy.get('script-src')?.includes('https://analytics.apex.example'));
  assert.ok(policy.get('connect-src')?.includes('https://analytics.apex.example'));
  for (const origin of ['http://analytics.example', 'https://user:secret@analytics.example', 'https://analytics.example:8443', 'https://analytics.example/path', 'https://analytics.example/?injected=value', 'https://analytics.example/#fragment', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', "https://example.com;script-src 'none'", 'https://analytics.example;img-src', 'https://analytics.example,evil', 'https://-bad.example', 'https://bad..example', 'https://service.localhost', 'https://service.internal', 'not-a-url']) {
    assert.throws(() => posthogResourceOrigin(origin), /Invalid public analytics origin/);
    assert.throws(() => contentSecurityPolicy({ NEXT_PUBLIC_POSTHOG_HOST: origin }), /Invalid public analytics origin/);
  }
});
test('only the owner studio may frame public pages; the default policy stays unframeable', () => {
  assert.deepEqual(directives(contentSecurityPolicy({ NODE_ENV: 'production' })).get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives(contentSecurityPolicy({ NODE_ENV: 'production' }, { embeddable: true })).get('frame-ancestors'),
    ["'self'", 'https://snappycrew.com', 'https://www.snappycrew.com']);
});

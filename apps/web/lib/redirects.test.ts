import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMANENT_REDIRECTS } from './redirect-rules';
import MembershipPage from '../app/membership/page';
import AccountPage from '../app/account/page';

test('R3-REG-4: /membership and /account are permanent (308) redirects to /support', () => {
  for (const source of ['/membership', '/account']) {
    const rule = PERMANENT_REDIRECTS.find((entry) => entry.source === source);
    assert.ok(rule, `${source} has a config redirect`);
    assert.equal(rule.destination, '/support');
    assert.equal(rule.permanent, true);
  }
});

test('R3-REG-4: the page fallbacks answer 308, never a temporary 307', () => {
  for (const Page of [MembershipPage, AccountPage]) {
    assert.throws(() => Page(), (error: { digest?: string }) => {
      const [kind, , url, status] = (error.digest ?? '').split(';');
      return kind === 'NEXT_REDIRECT' && url === '/support' && status === '308';
    });
  }
});

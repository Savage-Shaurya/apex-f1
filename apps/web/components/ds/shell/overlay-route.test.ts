import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlayAfterRoute } from './nav-config';

// R3-CLICK-1: replay the header's state transitions for Back, Forward and a revisit.
function header() {
  let openedOn: string | null = null;
  let path = '/drivers';
  const render = () => { openedOn = overlayAfterRoute(openedOn, path); return openedOn === path; };
  return {
    navigate(next: string) { path = next; return render(); },
    open() { openedOn = path; return render(); },
    close() { openedOn = null; return render(); },
  };
}

test('R3-CLICK-1: an overlay opened on /teams does not reopen after Back then Forward', () => {
  const h = header();
  h.navigate('/teams');
  assert.equal(h.open(), true);
  assert.equal(h.navigate('/drivers'), false, 'Back closes it');
  assert.equal(h.navigate('/teams'), false, 'Forward does not reopen it');
});

test('R3-CLICK-1: a later visit to the same page arrives with the overlay closed; same-page renders keep it open', () => {
  const h = header();
  h.navigate('/teams');
  h.open();
  assert.equal(h.navigate('/teams'), true, 'staying on the page keeps it open');
  h.navigate('/drivers');
  assert.equal(h.navigate('/teams'), false);
  assert.equal(h.open(), true);
  assert.equal(h.close(), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleFilterKey } from './filter-key';

/** A keyboard event that records what the handler did, the way a browser would act on it. */
function press(key: string) {
  const e = { key, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  return e;
}
function harness(active: string | null) {
  const calls = { picked: [] as string[], closed: 0, focused: [] as string[] };
  const deps = { active, pick: (id: string) => calls.picked.push(id), close: () => { calls.closed++; }, focusTile: (id: string) => calls.focused.push(id) };
  return { calls, deps };
}

test('R3-CLICK-2: Enter in the driver filter picks the highlighted driver and never submits the picks form', () => {
  const { calls, deps } = harness('max_verstappen');
  const e = press('Enter');
  handleFilterKey(e, deps);
  // A text field's Enter submits its form unless the default is prevented: that started the save flow.
  assert.equal(e.defaultPrevented, true, 'Enter must not submit the surrounding form');
  assert.equal(e.propagationStopped, true);
  assert.deepEqual(calls.picked, ['max_verstappen']);
  assert.equal(calls.closed, 0);
});

test('Enter with no matching driver does nothing, and still never submits', () => {
  const { calls, deps } = harness(null);
  const e = press('Enter');
  handleFilterKey(e, deps);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(calls.picked, []);
});

test('Escape closes without picking; ArrowDown moves into the grid; typing is left alone', () => {
  const esc = harness('a');
  handleFilterKey(press('Escape'), esc.deps);
  assert.equal(esc.calls.closed, 1);
  assert.deepEqual(esc.calls.picked, []);

  const down = harness('lando_norris');
  const d = press('ArrowDown');
  handleFilterKey(d, down.deps);
  assert.deepEqual(down.calls.focused, ['lando_norris']);
  assert.equal(d.defaultPrevented, true);

  const typing = harness('a');
  const t = press('n');
  handleFilterKey(t, typing.deps);
  assert.equal(t.defaultPrevented, false, 'letters must reach the input');
  assert.deepEqual(typing.calls.picked, []);
});

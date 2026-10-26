import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuitPath, getCircuit } from '@/lib/circuits';
import { advanceClock, cometLayers, dashAt, fitViewBox, lapHead, pathPoints, pointsBounds, startMarker, traceMode, PATH_UNITS } from './circuit-trace';

/** Whether path distance `x` is inside a dash, by the SVG dash rules (one dash, then one gap). */
function covered(x: number, dasharray: string, dashoffset: number): boolean {
  const [dash, gap] = dasharray.split(' ').map(Number) as [number, number];
  const period = dash + gap;
  const pos = (((x + dashoffset) % period) + period) % period;
  return pos < dash;
}

const mexico = getCircuit('rodriguez')!;

test('the path parser reads the real circuit outline and its bounds are the geometry box', () => {
  const pts = pathPoints(circuitPath(mexico));
  assert.equal(pts.length, mexico.points.length / 2);
  assert.deepEqual(pts[0], [182.6, 14.2]);
  assert.deepEqual(pointsBounds(pts), { minX: 0, minY: 0, maxX: 1000, maxY: 721.9 });
  assert.equal(pointsBounds([]), null);
});

test('the viewBox wraps the outline with the same padding on every side, so it is centred', () => {
  assert.equal(fitViewBox({ minX: 0, minY: 0, maxX: 1000, maxY: 721.9 }, 20), '-20 -20 1040 761.9');
  // An outline that does not start at the origin is still centred on its own box.
  const [x, y, w, h] = fitViewBox({ minX: 100, minY: 50, maxX: 400, maxY: 650 }, 30).split(' ').map(Number) as [number, number, number, number];
  assert.equal(100 - x, x + w - 400);
  assert.equal(50 - y, y + h - 650);
  assert.equal(x + w / 2, 250);
  assert.equal(y + h / 2, 350);
});

test('mid-lap the tail covers exactly the stretch behind the head', () => {
  const { dasharray, dashoffset } = dashAt(500, 140);
  assert.ok(covered(360.5, dasharray, dashoffset));
  assert.ok(covered(499.5, dasharray, dashoffset));
  assert.ok(!covered(359, dasharray, dashoffset));
  assert.ok(!covered(501, dasharray, dashoffset));
});

test('at the lap seam the tail wraps across the start line instead of being cut', () => {
  const { dasharray, dashoffset } = dashAt(20, 140);
  assert.ok(covered(0, dasharray, dashoffset), 'just after the line');
  assert.ok(covered(19.5, dasharray, dashoffset), 'the head');
  assert.ok(covered(PATH_UNITS - 1, dasharray, dashoffset), 'just before the line');
  assert.ok(covered(880.5, dasharray, dashoffset), 'end of the tail');
  assert.ok(!covered(879, dasharray, dashoffset));
  assert.ok(!covered(21, dasharray, dashoffset));
  assert.ok(dashoffset >= 0 && dashoffset < PATH_UNITS);
});

test('crossing the seam does not jump: the offset moves by the head step, modulo the lap', () => {
  const before = dashAt(PATH_UNITS - 0.2, 140).dashoffset;
  const after = dashAt(0.2, 140).dashoffset;
  const step = (((before - after) % PATH_UNITS) + PATH_UNITS) % PATH_UNITS;
  assert.ok(Math.abs(step - 0.4) < 1e-9, `step ${step}`);
});

test('the head moves at constant speed and wraps once per lap', () => {
  assert.equal(lapHead(0, 8000), 0);
  assert.equal(lapHead(2000, 8000), 250);
  assert.equal(lapHead(4000, 8000), 500);
  assert.equal(lapHead(8000, 8000), 0);
  assert.equal(lapHead(10000, 8000), 250);
  assert.equal(lapHead(0, 8000, 900), 900);
  assert.equal(lapHead(1000, 8000, 900), 25);
});

test('a resumed tab or a long frame never makes the trace leap', () => {
  assert.equal(advanceClock(1000, 16), 1016);
  assert.equal(advanceClock(1000, 30000), 1000 + 50);
  assert.equal(advanceClock(1000, -5), 1000);
  assert.equal(advanceClock(1000, Number.NaN), 1000);
});

test('the comet is a white head fading through red to transparent over 12-18% of a lap', () => {
  const layers = cometLayers();
  assert.ok(layers.length >= 10);
  // Painted back to front: longest (tail) first, shortest (head) last.
  for (let i = 1; i < layers.length; i++) {
    assert.ok(layers[i]!.length < layers[i - 1]!.length, 'shorter layers paint on top');
    assert.ok(layers[i]!.width >= layers[i - 1]!.width, 'the tail tapers away from the head');
    assert.ok(layers[i]!.opacity >= layers[i - 1]!.opacity, 'the tail fades away from the head');
  }
  const tail = layers[0]!;
  const head = layers[layers.length - 1]!;
  assert.ok(tail.length >= 0.12 * PATH_UNITS && tail.length <= 0.18 * PATH_UNITS, `tail ${tail.length}`);
  assert.equal(head.color, 'rgb(255 255 255)');
  assert.equal(head.opacity, 1);
  assert.ok(tail.opacity < 0.1, 'the end of the tail is nearly transparent');
  assert.match(tail.color, /^rgb\(2\d\d \d{1,2} \d{1,2}\)$/, 'the end of the tail is brand red');
});

test('reduced motion gets a still full-lap trace, otherwise the comet laps', () => {
  assert.equal(traceMode(true), 'static');
  assert.equal(traceMode(false), 'lap');
});

test('the start/finish marker sits on the first point, square to the track direction', () => {
  const m = startMarker(pathPoints(circuitPath(mexico)))!;
  assert.equal(m.x, 182.6);
  assert.equal(m.y, 14.2);
  const expected = (Math.atan2(48.6 - 14.2, 430.8 - 182.6) * 180) / Math.PI;
  assert.ok(Math.abs(m.angle - expected) < 1e-3);
  assert.equal(m.angle, Number(m.angle.toFixed(3)), 'rounded, so server and client transforms match');
  assert.equal(startMarker([[1, 1]]), null);
});

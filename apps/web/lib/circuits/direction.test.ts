import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCircuit } from './index';

// The lap trace follows the stored point order, so every outline must run in the race direction.
// Figure-eight Suzuka has no single orientation and is left out.
const RACE_DIRECTION: Record<string, 'clockwise' | 'anticlockwise'> = {
  albert_park: 'clockwise', bahrain: 'clockwise', shanghai: 'clockwise', catalunya: 'clockwise', monaco: 'clockwise',
  villeneuve: 'clockwise', red_bull_ring: 'clockwise', silverstone: 'clockwise', hungaroring: 'clockwise', spa: 'clockwise',
  monza: 'clockwise', zandvoort: 'clockwise', rodriguez: 'clockwise', losail: 'clockwise',
  marina_bay: 'anticlockwise', americas: 'anticlockwise', interlagos: 'anticlockwise', yas_marina: 'anticlockwise',
  jeddah: 'anticlockwise', miami: 'anticlockwise', baku: 'anticlockwise', vegas: 'anticlockwise', imola: 'anticlockwise',
};

/** Orientation on screen (y grows downwards): a positive shoelace sum turns clockwise. */
function drawnDirection(points: readonly number[]): 'clockwise' | 'anticlockwise' {
  let sum = 0;
  for (let i = 0; i < points.length; i += 2) {
    const j = (i + 2) % points.length;
    sum += points[i]! * points[j + 1]! - points[j]! * points[i + 1]!;
  }
  return sum > 0 ? 'clockwise' : 'anticlockwise';
}

test('every calendar circuit outline runs in its race direction (the lap trace follows point order)', () => {
  for (const [id, direction] of Object.entries(RACE_DIRECTION)) {
    const circuit = getCircuit(id);
    assert.ok(circuit, `${id} geometry exists`);
    assert.equal(drawnDirection(circuit.points), direction, `${id} runs ${direction}`);
  }
});

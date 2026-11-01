import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseRatio, photoFraming } from './media-rules';

const plinth = parseRatio('4 / 5');

test('photoFraming: cover with faces in the upper third within tolerance, matted whole beyond it', () => {
  assert.deepEqual(photoFraming({ width: 800, height: 1000 }, plinth), { fit: 'cover', focal: '50% 22%' });
  assert.deepEqual(photoFraming({ width: 640, height: 640 }, plinth), { fit: 'cover', focal: '50% 22%' });
  assert.deepEqual(photoFraming({ width: 960, height: 574 }, plinth), { fit: 'contain', focal: '50% 50%' });
  assert.deepEqual(photoFraming(null, plinth), { fit: 'cover', focal: '50% 22%' });
});

test('DRV-7: Portrait frames photographs through photoFraming, and square season portraits get a square plinth', () => {
  assert.match(readFileSync(new URL('./Portrait.tsx', import.meta.url), 'utf8'), /photoFraming\(/);
  const hall = readFileSync(new URL('../drivers/hall/ChampionsHall.tsx', import.meta.url), 'utf8');
  assert.match(hall, /ratio=\{p\.kind === 'photo' && p\.yearSpecific \? '1 \/ 1' : undefined\}/);
  const wall = readFileSync(new URL('../drivers/hall/DriverHall.tsx', import.meta.url), 'utf8');
  assert.match(wall, /ratio=\{picture\.yearSpecific \? '1 \/ 1' : undefined\}/);
});

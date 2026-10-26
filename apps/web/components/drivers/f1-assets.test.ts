import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commonsCredit, facingLeft, numberGlyph } from './f1-assets';

const cutout = 'https://media.formula1.com/image/upload/c_fit,w_960,q_auto,f_auto/common/f1/2026/mercedes/andant01/2026mercedesandant01right.webp';

test('sibling CDN assets are derived only from a verified right-facing cut-out', () => {
  assert.equal(facingLeft(cutout), cutout.replace('right.webp', 'left.webp'));
  assert.equal(numberGlyph(cutout), cutout.replace('right.webp', 'numberwhitefrless.webp'));
  assert.equal(facingLeft(null), null);
  assert.equal(numberGlyph('https://upload.wikimedia.org/x.jpg'), null);
});

test('commonsCredit names the author, licence and Commons, linked to the file page', () => {
  const credit = commonsCredit({ author: 'Jane Doe', license: 'CC BY-SA 4.0', licenseUrl: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg' });
  assert.deepEqual(credit, { label: 'Photo: Jane Doe, CC BY-SA 4.0, Wikimedia Commons', href: 'https://commons.wikimedia.org/wiki/File:X.jpg' });
  assert.equal(commonsCredit({ author: null, license: null, licenseUrl: null, sourceUrl: 's' })?.label, 'Photo: Wikimedia Commons contributor, Wikimedia Commons');
  assert.equal(commonsCredit(null), null);
});

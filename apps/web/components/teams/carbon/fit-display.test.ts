import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitDisplay } from './parts';

/** The divisor in `calc(100cqi / N)`: the heading's width in em at the fitted size. */
const divisor = (text: string, stretch?: number) => Number(/calc\(100cqi \/ ([\d.]+)\)/.exec(fitDisplay(text, '5rem', stretch))?.[1]);

// Rendered widths (em) of the uppercase word in .bc-display, measured in Chromium at 1024 px
// (Anybody 780, 122% stretch, 0.01em tracking). /teams/brabham broke "BRABHAM" mid-word at 1024
// because the length-only estimate (7 x 0.92 = 6.44 em) is narrower than the real 6.49 em.
const MEASURED: Record<string, number> = { BRABHAM: 6.492 };

test('the fitted size leaves every measured word room to stay on one line', () => {
  for (const [word, em] of Object.entries(MEASURED)) {
    assert.ok(divisor(word) > em, `${word}: divisor ${divisor(word)} must exceed the rendered ${em} em`);
    assert.ok(divisor(word.toLowerCase()) > em, 'lowercase source text is uppercased by CSS and measured as such');
  }
});

test('wide capitals (M, W) shrink the size; narrow words never grow past the length estimate', () => {
  assert.ok(divisor('Mmmm') > divisor('Iiii'));
  for (const word of ['Williams', 'Lotus', 'Ferrari', 'Constructors', 'IIII']) {
    assert.ok(divisor(word) >= Math.max(4, word.length) * 0.92 - 1e-9, `${word} keeps at least the length-based divisor`);
  }
});

test('the widest word of a multi-word name decides, hyphenated parts may wrap at the hyphen', () => {
  assert.equal(divisor('Aston Martin'), divisor('Martin'));
  assert.equal(divisor('Lotus-Climax'), Math.max(divisor('Lotus-'), divisor('Climax')));
  assert.equal(divisor('Hülkenberg'), divisor('Hulkenberg'), 'accented capitals measure as their base letter');
});

test('a narrower stretch scales the divisor down proportionally', () => {
  assert.ok(Math.abs(divisor('Brabham', 1.0) - divisor('Brabham') * (1.0 / 1.22)) < 0.01);
});

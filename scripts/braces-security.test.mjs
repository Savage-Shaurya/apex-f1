import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// Resolve the actual lint dependency chain, so a copied package cannot create
// a passing result while the installed development dependency stays unbounded.
const web = createRequire(new URL('../apps/web/package.json',import.meta.url));
const config = createRequire(web.resolve('eslint-config-next'));
const plugin = createRequire(config.resolve('@next/eslint-plugin-next'));
const glob = createRequire(plugin.resolve('fast-glob'));
const match = createRequire(glob.resolve('micromatch'));
const braces = match('braces');

test('installed glob parser rejects excessive structural nesting with a controlled error',()=>{
  for (const [open,close] of [['{','}'],['(',')']]) {
    for (const pattern of [open.repeat(65)+'x'+close.repeat(65),open.repeat(65)]) {
      for (const operation of ['parse','compile','expand','stringify']) {
        assert.throws(()=>braces[operation](pattern),error=>error instanceof SyntaxError && /nesting/.test(error.message));
      }
    }
  }
  assert.throws(()=>braces.parse('{('.repeat(33)+'x'+')}'.repeat(33)),SyntaxError);
  assert.doesNotThrow(()=>braces.compile('('.repeat(64)+'x'+')'.repeat(64)));
});

test('ordinary file patterns, ranges and literal structural characters retain their behavior',()=>{
  assert.deepEqual(braces.expand('apps/{web,workers}/src/*.{ts,tsx}'),[
    'apps/web/src/*.ts','apps/web/src/*.tsx','apps/workers/src/*.ts','apps/workers/src/*.tsx',
  ]);
  assert.deepEqual(braces.expand('release-{01..03}'),['release-01','release-02','release-03']);
  assert.equal(braces.compile('src/{app,lib}/*.ts'),'src/(app|lib)/*.ts');
  for (const literal of ['"'+'{'.repeat(70)+'"','['+'('.repeat(70)+']','\\{'.repeat(70)]) {
    assert.doesNotThrow(()=>braces.parse(literal));
  }
  assert.throws(()=>braces.parse('a'.repeat(10001)),error=>error instanceof SyntaxError && /max characters/.test(error.message));
});

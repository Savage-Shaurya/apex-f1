import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { bestRendition } from './image-renditions';
import { getCircuitHeroImage, isOtherSeriesImage } from './commons-image';
import { BRAND_STATEMENT, DATA_CREDITS, IMAGE_CREDITS, NON_AFFILIATION_STATEMENT, REFERENCE_GROUPS } from './credits';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('F1 media Cloudinary URLs get a width-rewritten srcset from the same transform', () => {
  const src = 'https://media.formula1.com/image/upload/c_fill,g_north,ar_1:1,w_840,q_auto,f_auto/common/f1/2026/audi/gabbor01/2026audigabbor01right.webp';
  const r = bestRendition(src);
  assert.equal(r.src, src);
  assert.match(r.srcSet!, /c_fill,g_north,ar_1:1,w_320,q_auto,f_auto\/common\/f1\/2026\/audi\/gabbor01\/2026audigabbor01right\.webp 320w/);
  assert.match(r.srcSet!, /w_1920,q_auto,f_auto\/.* 1920w$/);
  // SVG logos carry no transform and pass through untouched.
  const logo = 'https://media.formula1.com/image/upload/common/f1/2026/mclaren/2026mclarenlogowhite.svg';
  assert.deepEqual(bestRendition(logo), { src: logo });
});

test('Wikimedia originals and odd widths become bucketed thumbnails, never the original file', () => {
  const original = 'https://upload.wikimedia.org/wikipedia/commons/5/52/Photo.jpg?utm_source=en.wikipedia.org';
  const r = bestRendition(original);
  // Delivered from Apex's own origin (F-11, lib/commons-proxy.ts).
  assert.equal(r.src, '/media/commons/thumb/5/52/Photo.jpg/960px-Photo.jpg');
  assert.equal(r.srcSet, [330, 500, 960, 1280, 1920].map((w) => `/media/commons/thumb/5/52/Photo.jpg/${w}px-Photo.jpg ${w}w`).join(', '));
  assert.ok(!r.fallbacks?.length);
  const thumb = bestRendition('https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Photo.jpg/330px-Photo.jpg?utm_source=x');
  assert.equal(thumb.src, '/media/commons/thumb/5/52/Photo.jpg/330px-Photo.jpg');
  assert.ok(!/(?:400|800|1200|1600|2400)px-/.test(thumb.srcSet!));
  const filePath = bestRendition('https://commons.wikimedia.org/wiki/Special:FilePath/Photo.jpg');
  assert.equal(filePath.maxWidth, 1280);
  assert.ok(!filePath.srcSet!.includes('/1600/'));
  assert.equal(filePath.src, '/media/commons/filepath/960/Photo.jpg');
});

test('stock image hosts have no rendition rule left', () => {
  const src = 'https://images.unsplash.com/photo-1?w=5000';
  assert.deepEqual(bestRendition(src), { src });
});

test('circuit photos of other series are not used as an F1 race hero', () => {
  const base = { description: null, categories: [] as string[] };
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'United_Autosports_ELMS_Red_Bull_Ring_2017-218.jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: '2022_4_Hours_of_Spa-Francorchamps_-_Circuit.jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Qatar_GP_2021.jpg', categories: ['2021 Qatar motorcycle Grand Prix'] }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Start_of_the_Porsche_Sprint_Challenge_North_America_at_the_F1_Miami_GP_-_2022.jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Moto 1000 GP (6366270607).jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Superbikes_at_Interlagos.jpg' }));
  assert.ok(!isOtherSeriesImage({ ...base, fileName: 'Motorsport_Park_aerial.jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Interlagos_2023.jpg', description: 'Final Copa Truck 2023' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Stock_Car_Pro_Series_Interlagos.jpg' }));
  assert.ok(isOtherSeriesImage({ ...base, fileName: 'Turismo_Carretera_Buenos_Aires.jpg' }));
  assert.ok(!isOtherSeriesImage({ ...base, fileName: 'Circuit_of_the_americas_cota_(52781066233).jpg', categories: ['Circuit of the Americas'] }));
  assert.ok(!isOtherSeriesImage({ ...base, fileName: '1975_Italian_GP_race_start_-_Niki_Lauda_&_Clay_Regazzoni_(Ferrari_312T).jpg' }));
});

test('R3-CODE-5: real F1 and venue photos are not rejected as another series', () => {
  // Spanish "carrera" means race: a Mexican Grand Prix photo is F1.
  assert.equal(isOtherSeriesImage({ fileName: 'Gran_Premio_de_México_2019_carrera.jpg', description: 'Carrera de Fórmula 1 en el Autódromo Hermanos Rodríguez', categories: [] }), false);
  // A venue aerial filed under "Moto racing venues" shows the circuit, not a motorbike race.
  assert.equal(isOtherSeriesImage({ fileName: 'Autodromo_Jose_Carlos_Pace_aerial.jpg', description: 'Aerial view of Interlagos', categories: ['Moto racing venues in Brazil', 'Autódromo José Carlos Pace'] }), false);
  assert.equal(isOtherSeriesImage({ fileName: 'Interlagos_aerial.jpg', description: null, categories: ['Motorcycle racing venues in Brazil', 'Truck racing venues'] }), false);
  // Event categories still count, and named other-series events still do.
  assert.equal(isOtherSeriesImage({ fileName: 'Qatar_GP_2021.jpg', description: null, categories: ['2021 Qatar motorcycle Grand Prix'] }), true);
  assert.equal(isOtherSeriesImage({ fileName: 'Porsche_Carrera_Cup_Spa.jpg', description: null, categories: [] }), true);
  assert.equal(isOtherSeriesImage({ fileName: 'Carrera_Panamericana_1953.jpg', description: null, categories: [] }), true);
});

function mockWikimedia(image: { file: string; width: number; height: number; mime: string; categories?: string[] }) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://www.wikidata.org/')) {
      return new Response(JSON.stringify({ entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: image.file } } }] } } } }), { status: 200 });
    }
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
      return new Response(JSON.stringify({ query: { pages: [{
        categories: (image.categories ?? []).map((title) => ({ title: `Category:${title}` })),
        imageinfo: [{ width: image.width, height: image.height, mime: image.mime, extmetadata: {
          Artist: { value: 'Zach Catanzareti Photo' }, LicenseShortName: { value: 'CC BY 2.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' },
        } }],
      }] } }), { status: 200 });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  return calls;
}

test('a race hero is a scaled Commons thumbnail carrying author and licence', async () => {
  mockWikimedia({ file: 'Circuit of the americas cota (52781066233).jpg', width: 5184, height: 3456, mime: 'image/jpeg' });
  const hero = await getCircuitHeroImage({ circuitWikiUrl: 'https://en.wikipedia.org/wiki/Circuit_of_the_Americas', circuitName: 'Circuit of the Americas' });
  assert.ok(hero);
  assert.match(hero.src, /^\/media\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/Circuit_of_the_americas_cota_\(52781066233\)\.jpg\/1920px-/);
  assert.equal(hero.width, 1920);
  assert.equal(hero.height, 1280);
  assert.deepEqual(hero.credit, {
    author: 'Zach Catanzareti Photo', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Circuit_of_the_americas_cota_(52781066233).jpg',
  });
});

test('maps, low-resolution photos and other-series photos give no hero at all', async () => {
  const input = { circuitWikiUrl: 'https://en.wikipedia.org/wiki/Madring', circuitName: 'Madring' };
  mockWikimedia({ file: 'Madring (2026).svg', width: 755, height: 507, mime: 'image/svg+xml' });
  assert.equal(await getCircuitHeroImage(input), null);
  mockWikimedia({ file: 'Shanghai F1 Circui 01.jpg', width: 1024, height: 686, mime: 'image/jpeg' });
  assert.equal(await getCircuitHeroImage(input), null);
  mockWikimedia({ file: 'Qatar GP 2021.jpg', width: 3919, height: 2613, mime: 'image/jpeg', categories: ['2021 Qatar motorcycle Grand Prix'] });
  assert.equal(await getCircuitHeroImage(input), null);
  assert.equal(await getCircuitHeroImage({ circuitWikiUrl: null, circuitName: 'X' }), null);
});

test('credits state independence and every image and data source', () => {
  assert.equal(BRAND_STATEMENT, 'Apex is an independent, fan-built Formula 1 platform.');
  assert.match(NON_AFFILIATION_STATEMENT, /not affiliated with/i);
  assert.match(NON_AFFILIATION_STATEMENT, /Formula 1/);
  assert.deepEqual(REFERENCE_GROUPS.map((g) => g.id), ['data', 'images', 'news', 'community', 'software', 'type']);
  const names = REFERENCE_GROUPS.flatMap((g) => g.credits.map((c) => c.name));
  assert.equal(new Set(names).size, names.length, 'no duplicate credit');
  const images = IMAGE_CREDITS.map((c) => `${c.name} ${c.role}`).join(' ');
  assert.match(images, /Formula One Licensing/);
  assert.match(images, /Wikimedia Commons contributors/);
  const data = DATA_CREDITS.map((c) => c.name);
  for (const name of ['Jolpica F1', 'OpenF1', 'Open-Meteo', 'YouTube', 'Wikipedia contributors']) assert.ok(data.includes(name), name);
  // D2-MEDIA-CREDITS-6: the MIT circuit outlines carry their copyright line.
  const outlines = DATA_CREDITS.find((c) => c.href === 'https://github.com/bacinger/f1-circuits');
  assert.ok(outlines);
  assert.equal(outlines.license?.name, 'MIT');
  assert.match(outlines.role, /Tomislav Bacinger/);
});

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.turbo'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(full));
    else if (/\.(?:ts|tsx|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

test('no stock or reaction-GIF provider remains in product source or config', async () => {
  // The test runner starts in the repository root.
  const root = process.cwd();
  await readFile(path.join(root, 'turbo.json'), 'utf8');
  const files = [
    ...await sourceFiles(path.join(root, 'apps/web/app')),
    ...await sourceFiles(path.join(root, 'apps/web/components')),
    ...await sourceFiles(path.join(root, 'apps/web/lib')),
    ...await sourceFiles(path.join(root, 'packages/api-client/src')),
    path.join(root, 'turbo.json'), path.join(root, 'apps/web/next.config.ts'), path.join(root, 'apps/web/.env.example'),
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.ok(!/unsplash|giphy/i.test(text), path.relative(root, file));
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authorName, commonsBucket, commonsFileName, commonsThumbUrl, getCommonsImage, getEnwikiP18, plainText,
} from './index';

// A real Commons file (Max Verstappen's Wikipedia lead image); its md5 hash dir is 5/52.
const REAL = '2024-08-25_Motorsport,_Formel_1,_Großer_Preis_der_Niederlande_2024_STP_3973_by_Stepro_(medium_crop).jpg';
const REAL_ENC = encodeURIComponent(REAL);

test('file names are recovered from every Commons URL form and single-wiki files are rejected', () => {
  assert.equal(commonsFileName(`http://commons.wikimedia.org/wiki/Special:FilePath/${REAL_ENC}`), REAL);
  assert.equal(commonsFileName(`https://upload.wikimedia.org/wikipedia/commons/5/52/${REAL_ENC}?utm_source=x`), REAL);
  assert.equal(commonsFileName(`https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/${REAL_ENC}/330px-${REAL_ENC}`), REAL);
  assert.equal(commonsFileName('File:Circuit of the americas cota (52781066233).jpg'), 'Circuit_of_the_americas_cota_(52781066233).jpg');
  assert.equal(commonsFileName('https://upload.wikimedia.org/wikipedia/en/a/ab/Non_free_logo.png'), null);
  assert.equal(commonsFileName('https://example.com/wikipedia/commons/5/52/x.jpg'), null);
  assert.equal(commonsFileName('File:../../etc/passwd.jpg'), null);
  assert.equal(commonsFileName('Document.pdf'), null);
  assert.equal(commonsFileName(null), null);
});

test('thumbnails use only the widths the upload servers render', () => {
  assert.equal(commonsBucket(400), 500);
  assert.equal(commonsBucket(1600), 1920);
  assert.equal(commonsBucket(1600, 1100), 1280);
  assert.equal(commonsBucket(5000), 1920);
  assert.equal(
    commonsThumbUrl(REAL, 1000),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/${REAL_ENC}/1280px-${REAL_ENC}`,
  );
  assert.match(commonsThumbUrl('Madring_(2026).svg', 960)!, /\/960px-Madring_\(2026\)\.svg\.png$/);
});

test('Commons HTML metadata becomes short plain text without signature timestamps', () => {
  assert.equal(plainText('<a href="//commons.wikimedia.org/wiki/User:X">Zach&nbsp;Catanzareti</a> Photo'), 'Zach Catanzareti Photo');
  assert.equal(authorName('<a href="x">Mutari</a> 10:51, 21 September 2007 (UTC)'), 'Mutari');
  assert.equal(authorName(''), null);
  assert.equal(plainText(42), null);
});

test('image info parses size, author, licence, description and categories from the API', async () => {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      query: { pages: [{
        title: 'File:Circuit_of_the_americas_cota_(52781066233).jpg',
        categories: [{ title: 'Category:Circuit of the Americas' }],
        imageinfo: [{
          width: 5184, height: 3456, mime: 'image/jpeg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Circuit_of_the_americas_cota_(52781066233).jpg',
          extmetadata: {
            Artist: { value: '<a href="https://www.flickr.com/people/x">Zach Catanzareti Photo</a>' },
            LicenseShortName: { value: 'CC BY 2.0' },
            LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' },
            ImageDescription: { value: '<p>Circuit of the Americas</p>' },
          },
        }],
      }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const image = await getCommonsImage('File:Circuit of the americas cota (52781066233).jpg', { fetchImpl });
  assert.deepEqual(image, {
    fileName: 'Circuit_of_the_americas_cota_(52781066233).jpg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Circuit_of_the_americas_cota_(52781066233).jpg',
    width: 5184, height: 3456, mime: 'image/jpeg',
    author: 'Zach Catanzareti Photo', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
    description: 'Circuit of the Americas', categories: ['Circuit of the Americas'],
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /^https:\/\/commons\.wikimedia\.org\/w\/api\.php\?/);
});

test('provider failures and missing files are a truthful null, never an invented image', async () => {
  const failing = (async () => new Response('busy', { status: 429 })) as typeof fetch;
  assert.equal(await getCommonsImage('File:X.jpg', { fetchImpl: failing }), null);
  assert.equal(await getEnwikiP18('Circuit_of_the_Americas', { fetchImpl: failing }), null);
  const missing = (async () => new Response(JSON.stringify({ query: { pages: [{ missing: true }] } }), { status: 200 })) as typeof fetch;
  assert.equal(await getCommonsImage('File:X.jpg', { fetchImpl: missing }), null);
});

test('the circuit image is the Wikidata P18 of the linked English article', async () => {
  let requested = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ entities: { Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Circuit of the americas cota (52781066233).jpg' } } }] } } } }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await getEnwikiP18('Las_Vegas_Grand_Prix#Circuit', { fetchImpl }), 'Circuit_of_the_americas_cota_(52781066233).jpg');
  const url = new URL(requested);
  assert.equal(url.searchParams.get('sites'), 'enwiki');
  assert.equal(url.searchParams.get('titles'), 'Las Vegas Grand Prix');
});

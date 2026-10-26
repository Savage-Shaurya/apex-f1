import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  f1DriverAssetPath, f1DriverRefs, f1FitUrl, f1HeadshotUrl, f1MasterUrl, f1TeamCarPath, f1TeamFolder, f1TeamLogoPath,
} from './f1-media-urls';

test('every 2026 OpenF1 team name maps to its CDN folder, with the Jolpica id as fallback', () => {
  const byTiming: Record<string, string> = {
    McLaren: 'mclaren', Ferrari: 'ferrari', Mercedes: 'mercedes', 'Red Bull Racing': 'redbullracing',
    'Racing Bulls': 'racingbulls', 'Aston Martin': 'astonmartin', Alpine: 'alpine', Williams: 'williams',
    'Haas F1 Team': 'haasf1team', Audi: 'audi', Cadillac: 'cadillac',
  };
  for (const [name, folder] of Object.entries(byTiming)) assert.equal(f1TeamFolder(null, name), folder, name);
  assert.equal(f1TeamFolder('rb'), 'racingbulls');
  assert.equal(f1TeamFolder('red_bull', 'Unknown Team'), 'redbullracing');
  assert.equal(f1TeamFolder('brabham'), null);
  assert.equal(f1TeamFolder(null, null), null);
});

test('driver references come from the OpenF1 headshot path first, then the FOM naming rule', () => {
  assert.deepEqual(f1DriverRefs({
    headshotUrl: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/K/ANDANT01_Kimi_Antonelli/andant01.png.transform/1col/image.png',
    firstName: 'Andrea Kimi', lastName: 'Antonelli',
  }), ['andant01']);
  assert.deepEqual(f1DriverRefs({ firstName: 'Nico', lastName: 'Hülkenberg' }), ['nichul01']);
  assert.deepEqual(f1DriverRefs({ firstName: 'Sergio', lastName: 'Pérez' }), ['serper01']);
  assert.deepEqual(f1DriverRefs({ firstName: 'Arvid', lastName: 'Lindblad' }), ['arvlin01']);
  assert.deepEqual(f1DriverRefs({ firstName: 'Zhou', lastName: 'Gu' }), []);
});

test('asset paths follow the verified CDN convention and refuse unsafe segments', () => {
  assert.equal(f1DriverAssetPath(2026, 'racingbulls', 'arvlin01'), 'common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01right.webp');
  assert.equal(f1TeamCarPath(2026, 'haasf1team'), 'common/f1/2026/haasf1team/2026haasf1teamcarright.webp');
  assert.equal(f1TeamLogoPath(2026, 'mclaren'), 'common/f1/2026/mclaren/2026mclarenlogowhite.svg');
  assert.equal(f1DriverAssetPath(2026, '../x', 'arvlin01'), null);
  assert.equal(f1TeamCarPath(1990, 'ferrari'), null);
  assert.equal(f1TeamLogoPath(Number.NaN, 'ferrari'), null);
});

test('renditions are sized Cloudinary transforms; headshots frame the head without a side crop', () => {
  const path = 'common/f1/2026/mclaren/lannor01/2026mclarenlannor01right.webp';
  assert.equal(f1MasterUrl(path), `https://media.formula1.com/image/upload/${path}`);
  assert.equal(f1HeadshotUrl(path), `https://media.formula1.com/image/upload/c_fill,g_north,ar_1:1,w_840,q_auto,f_auto/${path}`);
  assert.equal(f1FitUrl(path, 960), `https://media.formula1.com/image/upload/c_fit,w_960,q_auto,f_auto/${path}`);
});

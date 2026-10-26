import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudinaryAspect, f1FramedCutout, f1SeasonPortraitPath, f1SeasonPortraitUrl, isPhotograph } from './f1-media-urls';
import { bestRendition } from './image-renditions';
import { initialsOf } from '../components/ds/initials';

const CUT = 'common/f1/2025/mclaren/lannor01/2025mclarenlannor01right.webp';

test('cut-outs are re-framed by the CDN from the top, keeping the master path', () => {
  assert.equal(
    f1FramedCutout(`https://media.formula1.com/image/upload/c_fit,w_960,q_auto,f_auto/${CUT}`, '4:5'),
    `https://media.formula1.com/image/upload/c_fill,g_north,ar_4:5,w_640,q_auto,f_auto/${CUT}`,
  );
  // An existing head-and-shoulders transform and an untransformed master both reframe.
  assert.match(f1FramedCutout(`https://media.formula1.com/image/upload/c_fill,g_north,ar_1:1,w_840,q_auto,f_auto/${CUT}`, '1:1'), /c_fill,g_north,ar_1:1,w_640/);
  assert.match(f1FramedCutout(`https://media.formula1.com/image/upload/${CUT}`, '5:6'), /ar_5:6/);
  assert.match(f1FramedCutout(`https://media.formula1.com/image/upload/c_fit,w_960/${CUT.replace('right', 'left')}`, '4:5'), /left\.webp$/);
  // Anything else passes through untouched.
  const car = 'https://media.formula1.com/image/upload/c_fit,w_1600,q_auto,f_auto/common/f1/2026/mclaren/2026mclarencarright.webp';
  assert.equal(f1FramedCutout(car, '4:5'), car);
  assert.equal(f1FramedCutout('https://upload.wikimedia.org/x.jpg', '4:5'), 'https://upload.wikimedia.org/x.jpg');
  assert.equal(f1FramedCutout(`https://media.formula1.com/image/upload/${CUT}`, 'bad'), `https://media.formula1.com/image/upload/${CUT}`);
});

test('CSS ratios convert to Cloudinary aspect values', () => {
  assert.equal(cloudinaryAspect('4 / 5'), '4:5');
  assert.equal(cloudinaryAspect('1/1'), '1:1');
  assert.equal(cloudinaryAspect('1200 / 264'), '1200:264');
  assert.equal(cloudinaryAspect('auto'), null);
});

test('season portraits exist only for the archive years and use real renditions', () => {
  assert.equal(f1SeasonPortraitPath(2021, 'Verstappen'), 'https://media.formula1.com/content/dam/fom-website/drivers/2021Drivers/verstappen.jpg');
  assert.equal(f1SeasonPortraitPath(2016, 'Räikkönen'), 'https://media.formula1.com/content/dam/fom-website/drivers/2016Drivers/raikkonen.jpg');
  assert.equal(f1SeasonPortraitPath(2013, 'Vettel'), null);
  assert.equal(f1SeasonPortraitPath(2024, 'Verstappen'), null);
  const url = f1SeasonPortraitUrl(f1SeasonPortraitPath(2020, 'Hamilton')!, 640);
  assert.equal(url, 'https://media.formula1.com/content/dam/fom-website/drivers/2020Drivers/hamilton.jpg.img.640.medium.jpg');
  const r = bestRendition(url);
  assert.equal(r.src, url);
  assert.match(r.srcSet ?? '', /hamilton\.jpg\.img\.1536\.medium\.jpg 1536w/);
  assert.equal(r.maxWidth, 1920);
});

test('photographs are told apart from transparent cut-outs', () => {
  assert.equal(isPhotograph('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/330px-x.jpg'), true);
  assert.equal(isPhotograph('https://media.formula1.com/content/dam/fom-website/drivers/2021Drivers/verstappen.jpg.img.640.medium.jpg'), true);
  assert.equal(isPhotograph(`https://media.formula1.com/image/upload/${CUT}`), false);
  assert.equal(isPhotograph(null), false);
});

test('initials for the no-photo state', () => {
  assert.equal(initialsOf('Max Verstappen'), 'MV');
  assert.equal(initialsOf('Kimi Räikkönen'), 'KR');
  assert.equal(initialsOf('Andrea Kimi Antonelli'), 'AA');
  assert.equal(initialsOf('Fangio'), 'F');
  assert.equal(initialsOf(''), '');
});

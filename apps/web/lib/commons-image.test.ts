import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuitHeroAlt, isOtherSeriesImage } from './commons-image';

test('D2-MEDIA-CREDITS-1: truck and stock-car photos are rejected as other-series heroes (Interlagos Copa Truck)', () => {
  const copaTruck = { fileName: 'Autodromo_Jose_Carlos_Pace_2023.jpg', description: 'Final Copa Truck 2023', categories: ['Autódromo José Carlos Pace'] };
  assert.equal(isOtherSeriesImage(copaTruck), true);
  for (const description of ['Stock Car Pro Series round at Interlagos', 'Turismo Carretera at the circuit', 'Formula Truck race 2019', 'Porsche Cup Brasil grid']) {
    assert.equal(isOtherSeriesImage({ fileName: 'x.jpg', description, categories: [] }), true, description);
  }
  assert.equal(isOtherSeriesImage({ fileName: 'Interlagos_2019_F1.jpg', description: 'Formula One cars on the main straight at Interlagos', categories: [] }), false);
});

test('D2-MEDIA-CREDITS-3: hero alt text drops catalogue, foreign-language and file-name descriptions', () => {
  assert.equal(circuitHeroAlt('Silverstone Circuit', 'Silverstone Circuit, Northamptonshire: 168'), 'Silverstone Circuit');
  assert.equal(circuitHeroAlt('Sepang International Circuit', 'Международный автодром Сепанг'), 'Sepang International Circuit');
  assert.equal(circuitHeroAlt('Monza', 'Autodromo Nazionale di Monza, vista aerea'), 'Monza circuit');
  assert.equal(circuitHeroAlt('Zandvoort', 'Fotocollectie Anefo 1965 inventarisnummer 918-2104'), 'Zandvoort circuit');
  assert.equal(circuitHeroAlt('Suzuka', 'DSC01234.JPG'), 'Suzuka circuit');
  assert.equal(circuitHeroAlt('Circuit of the Americas', 'Aerial view of the track and main grandstand.'), 'Circuit of the Americas: Aerial view of the track and main grandstand');
  assert.equal(circuitHeroAlt('Monaco', null), 'Monaco circuit');
});

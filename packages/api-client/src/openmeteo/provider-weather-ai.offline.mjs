// Actual production modules, isolated environment and synthetic network only.
// Run: node --experimental-vm-modules --test packages/api-client/src/openmeteo/provider-weather-ai.offline.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');

async function harness() {
  const env = { GROQ_API_KEY: 'synthetic-only', HUGGINGFACE_TOKEN: 'synthetic-only', NODE_ENV: 'production' };
  const state = { calls: [], reply: async () => { throw new Error('Unexpected mock network call'); } };
  const fetchImpl = async (url, init = {}) => {
    state.calls.push({ url: String(url), init });
    return state.reply(String(url), init);
  };
  const context = vm.createContext({ console, URL, Response, Request, Headers, AbortController, AbortSignal,
    Buffer, TextDecoder, TextEncoder, ReadableStream, setTimeout, clearTimeout, fetch: fetchImpl, process: { env } });
  const modules = new Map();
  async function load(filename) {
    const target = path.extname(filename) ? filename : fs.existsSync(`${filename}.ts`) ? `${filename}.ts` : path.join(filename, 'index.ts');
    if (modules.has(target)) return modules.get(target);
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(target, 'utf8'), { mode: 'transform' }), { context, identifier: target });
    modules.set(target, mod);
    return mod;
  }
  async function linker(specifier, reference) {
    if (specifier.startsWith('.')) return load(path.resolve(path.dirname(reference.identifier), specifier));
    if (!['node:fs/promises', 'node:os', 'node:path', 'node:crypto', 'node:url'].includes(specifier)) throw new Error(`Unexpected import ${specifier}`);
    const native = specifier === 'node:fs/promises' ? { writeFile: async () => { throw new Error('Filesystem writes forbidden in offline tests'); } } : await import(specifier);
    const names = Object.keys(native);
    return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, native[name]); }, { context });
  }
  async function api(relative) {
    const mod = await load(path.join(sourceRoot, relative));
    if (mod.status === 'unlinked') await mod.link(linker);
    if (mod.status !== 'evaluated') await mod.evaluate();
    return mod.namespace;
  }
  return { env, state, api, fetchImpl, enable() { env.GROQ_INFERENCE_ENABLED = 'true'; env.HUGGINGFACE_INFERENCE_ENABLED = 'true'; } };
}

function fixture() {
  return { source: 'forecast', latitude: 1, longitude: 103, timezone: 'Asia/Singapore',
    hourly: { time: ['2026-09-30T20:00', '2026-09-30T21:00', '2026-09-30T22:00'], temperature_2m: [30, 31, 32],
      precipitation: [0, 0, 0], precipitation_probability: [0, 0, 0], wind_speed_10m: [10, 10, 10],
      wind_direction_10m: [350, 0, 10], weathercode: [0, 0, 0] },
    daily: { time: ['2026-09-30'], temperature_2m_max: [32], temperature_2m_min: [28], precipitation_sum: [0],
      precipitation_probability_max: [0], wind_speed_10m_max: [10], weathercode: [0] } };
}
const mapping = (weather) => ({ weather, sessions: [{ kind: 'R', iso: '2026-09-30T12:00:00Z' }], raceStartIso: '2026-09-30T12:00:00Z' });
const today = () => new Date().toISOString().slice(0, 10);
const rawWeather = () => ({ utc_offset_seconds: 0, timezone: 'GMT',
  hourly: { time: [`${today()}T12:00`], temperature_2m: [null], precipitation: [0], weathercode: [0],
    wind_speed_10m: [10], wind_direction_10m: [350], precipitation_probability: [0] },
  daily: { time: [today()], temperature_2m_max: [30], temperature_2m_min: [22], precipitation_sum: [null], wind_speed_10m_max: [10], weathercode: [0] } });
const weatherInput = (h, extra = {}) => ({ lat: 35, lon: 139, dateStart: today(), dateEnd: today(), fetchImpl: h.fetchImpl, ...extra });

test('legacy Singapore wall-clock weather aligns with UTC sessions independently of host timezone', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts');
  const result = api.mapRaceWeather(mapping(fixture()));
  assert.equal(result.sessions[0].peakAirTempC, 32);
  assert.equal(result.sessions[0].windDirectionDeg, 0);
  assert.equal(result.availability, 'available');
});

test('empty weather remains unavailable with nullable rain totals and risks', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  for (const block of ['hourly', 'daily']) for (const key of Object.keys(weather[block])) weather[block][key] = [];
  const result = api.mapRaceWeather(mapping(weather));
  assert.equal(result.summary, 'Conditions unavailable');
  assert.equal(result.availability, 'unavailable');
  assert.equal(result.sessions[0].precipitationMm, null);
  assert.equal(result.raceDay, null);
  assert.ok(Object.values(result.risks).every((value) => value === null));
});

test('a missing precipitation hour cannot become a synthetic dry total', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.hourly.precipitation = [0, null, 0]; weather.daily.precipitation_sum = [null];
  const result = api.mapRaceWeather(mapping(weather));
  assert.equal(result.sessions[0].precipitationMm, null);
  assert.equal(result.raceDay.totalPrecipitationMm, null);
  assert.equal(result.risks.heavyRain, null);
  assert.equal(result.availability, 'partial');
});

test('invalid measurements do not poison temperature or become zero', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.hourly.temperature_2m = [null, NaN, 31]; weather.daily.temperature_2m_max = [Infinity];
  const result = api.mapRaceWeather(mapping(weather));
  assert.equal(result.sessions[0].peakAirTempC, 31);
  assert.equal(result.raceDay.maxAirTempC, null);
});

test('opposing wind directions produce unknown instead of an invented north wind', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.hourly.wind_direction_10m = [90, 270, null];
  assert.equal(api.mapRaceWeather(mapping(weather)).sessions[0].windDirectionDeg, null);
  assert.equal(api.cardinalFromDeg(-45), 'NW');
});

test('unknown WMO values and absent conditions never claim Dry', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.hourly.weathercode = [10, null, NaN]; weather.daily.weathercode = [10];
  assert.equal(api.bucketFromWeathercode(54), 'unknown');
  assert.equal(api.bucketFromWeathercode(95), 'thunderstorm');
  const result = api.mapRaceWeather(mapping(weather));
  assert.ok(result.summary.startsWith('Conditions unavailable'));
  assert.equal(result.risks.thunderstorm, null);
});

test('legacy daily weather uses the actual local day when UTC race time crosses midnight', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.timezone = 'America/New_York'; weather.hourly.time = ['2026-09-30T21:00'];
  const result = api.mapRaceWeather({ weather, sessions: [{ kind: 'R', iso: '2026-10-01T01:00:00Z' }], raceStartIso: '2026-10-01T01:00:00Z' });
  assert.equal(result.raceDay.date, '2026-09-30');
  assert.equal(result.sessions[0].peakAirTempC, 30);
});

test('legacy DST weather conversion does not use a stale fixed host offset', async () => {
  const h = await harness(); const api = await h.api('openmeteo/mappers.ts'); const weather = fixture();
  weather.timezone = 'America/New_York'; weather.hourly.time = ['2026-03-08T03:00'];
  const result = api.mapRaceWeather({ weather, sessions: [{ kind: 'R', iso: '2026-03-08T07:00:00Z' }], raceStartIso: '2026-03-08T07:00:00Z' });
  assert.equal(result.sessions[0].peakAirTempC, 30);
});

test('weather fetch requests GMT, normalizes explicit Z, and preserves null field alignment', async () => {
  const h = await harness(); h.state.reply = async () => json(rawWeather()); const { openmeteo } = await h.api('openmeteo/client.ts');
  const result = await openmeteo.getRaceWeather(weatherInput(h));
  assert.equal(new URL(h.state.calls[0].url).searchParams.get('timezone'), 'GMT');
  assert.equal(result.utcOffsetSeconds, 0);
  assert.ok(result.hourly.time[0].endsWith('Z'));
  assert.equal(result.hourly.temperature_2m[0], null);
  assert.equal(result.daily.precipitation_sum[0], null);
});

test('configured commercial weather uses verified customer hosts with no public fallback', async () => {
  const h = await harness(); const { openmeteo } = await h.api('openmeteo/client.ts');
  h.env.OPENMETEO_API_KEY = 'synthetic-weather-key';
  h.state.reply = async () => json(rawWeather());
  assert.ok(await openmeteo.getRaceWeather(weatherInput(h)));
  const forecastUrl = new URL(h.state.calls[0].url);
  assert.equal(forecastUrl.hostname, 'customer-api.open-meteo.com');
  assert.equal(forecastUrl.pathname, '/v1/forecast');
  assert.equal(forecastUrl.searchParams.get('apikey'), h.env.OPENMETEO_API_KEY);
  const archivedDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  assert.ok(await openmeteo.getRaceWeather(weatherInput(h, { dateStart: archivedDate, dateEnd: archivedDate })));
  assert.equal(new URL(h.state.calls[1].url).hostname, 'customer-archive-api.open-meteo.com');
  assert.equal(new URL(h.state.calls[1].url).pathname, '/v1/archive');
  h.state.reply = async () => json({ error: true }, 403);
  assert.equal(await openmeteo.getRaceWeather(weatherInput(h)), null);
  assert.equal(h.state.calls.length, 3);
  assert.ok(h.state.calls.every(({ url }) => new URL(url).hostname.startsWith('customer-')));
});

test('weather rejects invalid coordinates, dates and reversed windows without network', async () => {
  const h = await harness(); const { openmeteo } = await h.api('openmeteo/client.ts');
  for (const extra of [{ lat: NaN }, { lon: 181 }, { dateStart: '2026-02-30' }, { dateStart: '2026-12-02', dateEnd: '2026-12-01' }]) {
    assert.equal(await openmeteo.getRaceWeather(weatherInput(h, extra)), null);
  }
  assert.equal(h.state.calls.length, 0);
});

test('weather rejects a contradicting upstream offset and malformed time arrays', async () => {
  const h = await harness(); const { openmeteo } = await h.api('openmeteo/client.ts');
  h.state.reply = async () => json({ ...rawWeather(), utc_offset_seconds: 32400 });
  assert.equal(await openmeteo.getRaceWeather(weatherInput(h)), null);
  h.state.reply = async () => json({ ...rawWeather(), hourly: { time: 'bad' } });
  assert.equal(await openmeteo.getRaceWeather(weatherInput(h)), null);
});

test('weather deadline covers a fetch that ignores AbortSignal', async () => {
  const h = await harness(); const { openmeteo } = await h.api('openmeteo/client.ts'); h.state.reply = async () => new Promise(() => {});
  const started = performance.now();
  assert.equal(await openmeteo.getRaceWeather(weatherInput(h, { timeoutMs: 20 })), null);
  assert.ok(performance.now() - started < 300);
});

test('strict weather sync propagates redacted provider failures instead of pretending success', async () => {
  const h = await harness(); const { openmeteo } = await h.api('openmeteo/client.ts');
  h.state.reply = async () => new Response('', { status: 503 });
  await assert.rejects(openmeteo.getRaceWeather(weatherInput(h, { strict: true })), /openmeteo: http/);
  h.state.reply = async () => json({ ...rawWeather(), utc_offset_seconds: 3600 });
  await assert.rejects(openmeteo.getRaceWeather(weatherInput(h, { strict: true })), /openmeteo: invalid-response/);
});

test('Groq requires caller opt-in and deployment flag independently of key presence', async () => {
  const h = await harness(); const { groqChat } = await h.api('groq/client.ts'); const messages = [{ role: 'user', content: 'Facts' }];
  assert.equal(await groqChat(messages), null);
  assert.equal(await groqChat(messages, { allowInference: true }), null);
  h.enable(); assert.equal(await groqChat(messages), null);
  assert.equal(h.state.calls.length, 0);
});

test('Groq validates request and response shapes before accepting content', async () => {
  const h = await harness(); h.enable(); const { groqChat } = await h.api('groq/client.ts');
  assert.equal(await groqChat([{ role: 'user', content: 1 }], { allowInference: true }), null);
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], { allowInference: true, maxTokens: Infinity }), null);
  assert.equal(h.state.calls.length, 0);
  h.state.reply = async () => json({ choices: [{ message: { content: { fake: true } } }] });
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], { allowInference: true }), null);
  h.state.reply = async () => json({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete' } }] });
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], { allowInference: true }), null);
});

test('Groq accepts validated content with no-store and a request signal', async () => {
  const h = await harness(); h.enable(); h.state.reply = async () => json({ choices: [{ finish_reason: 'stop', message: { content: ' Real summary. ' } }] });
  const { groqChat } = await h.api('groq/client.ts');
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], { allowInference: true }), 'Real summary.');
  assert.equal(h.state.calls[0].init.cache, 'no-store'); assert.ok(h.state.calls[0].init.signal);
});

test('Groq bounds connection and stuck response body with one deadline', async () => {
  const h = await harness(); h.enable(); const { groqChat } = await h.api('groq/client.ts'); const opts = { allowInference: true, timeoutMs: 20 };
  h.state.reply = async () => new Promise(() => {});
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], opts), null);
  h.state.reply = async () => new Response(new ReadableStream({ start() {} }));
  assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], opts), null);
});

test('Groq Retry-After cannot exceed the operation deadline', async () => {
  const h = await harness(); h.enable(); h.state.reply = async () => new Response('', { status: 429, headers: { 'retry-after': '999999' } });
  const { groqChat } = await h.api('groq/client.ts');
  const start = performance.now(); assert.equal(await groqChat([{ role: 'user', content: 'Facts' }], { allowInference: true, timeoutMs: 20 }), null);
  assert.ok(performance.now() - start < 300); assert.equal(h.state.calls.length, 1);
});

test('HF inference requires both opt-ins and uses the supported router', async () => {
  const h = await harness(); const { hfInference } = await h.api('huggingface/client.ts'); const input = { model: 'facebook/bart-large-cnn', inputs: 'Facts', allowInference: true };
  assert.equal(await hfInference(input), null); h.enable(); assert.equal(await hfInference({ ...input, allowInference: false }), null);
  assert.equal(h.state.calls.length, 0); h.state.reply = async () => json([{ summary_text: 'Summary' }]);
  assert.ok(await hfInference(input)); assert.equal(new URL(h.state.calls[0].url).hostname, 'router.huggingface.co');
  assert.equal(new URL(h.state.calls[0].url).pathname, '/hf-inference/models/facebook/bart-large-cnn');
});

test('HF rejects traversal, oversized inputs and the research-only translation model before fetch', async () => {
  const h = await harness(); h.enable(); const { hfInference } = await h.api('huggingface/client.ts');
  for (const model of ['../private', 'facebook/nllb-200-distilled-600M', 'https://evil.example/model']) {
    assert.equal(await hfInference({ model, inputs: 'Facts', allowInference: true }), null);
  }
  assert.equal(await hfInference({ model: 'facebook/bart-large-cnn', inputs: 'a'.repeat(64_001), allowInference: true }), null);
  assert.equal(h.state.calls.length, 0);
});

test('HF connection, body and hinted model warmup share a bounded deadline', async () => {
  const h = await harness(); h.enable(); const { hfInference } = await h.api('huggingface/client.ts');
  const input = { model: 'facebook/bart-large-cnn', inputs: 'Facts', allowInference: true, timeoutMs: 20 };
  h.state.reply = async () => new Promise(() => {}); assert.equal(await hfInference(input), null);
  h.state.reply = async () => new Response(new ReadableStream({ start() {} })); assert.equal(await hfInference(input), null);
  h.state.reply = async () => json({ estimated_time: 1e12 }, 503); assert.equal(await hfInference(input), null);
});

test('malformed sentiment labels and out-of-range confidence fail safely', async () => {
  const h = await harness(); h.enable(); const { scoreSentiment } = await h.api('huggingface/sentiment.ts');
  h.state.reply = async () => json([[{ label: null, score: 0.9 }, { label: 'positive', score: 7 }]]);
  assert.equal(await scoreSentiment('Facts', { allowInference: true }), null);
  h.state.reply = async () => json([[{ label: 'LABEL_2', score: 0.8 }, { label: 'LABEL_0', score: 0.2 }]]);
  const result = await scoreSentiment('Facts', { allowInference: true }); assert.equal(result.label, 'positive'); assert.equal(result.score, 0.8);
});

test('sentiment batches limit concurrency and preserve ordered nullable results', async () => {
  const h = await harness(); h.enable(); const { scoreSentimentBatch } = await h.api('huggingface/sentiment.ts'); let active = 0; let peak = 0;
  h.state.reply = async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return json([{ label: 'neutral', score: 0.7 }]); };
  const results = await scoreSentimentBatch(['a', 'b', 'c', 'd', 'e'], { allowInference: true });
  assert.equal(results.length, 5); assert.ok(results.every((item) => item.label === 'neutral')); assert.equal(peak, 2);
});

test('summarization rejects invalid budgets and malformed output', async () => {
  const h = await harness(); h.enable(); const { summarize } = await h.api('huggingface/summarize.ts');
  assert.equal(await summarize('Facts', Infinity, { allowInference: true }), null); assert.equal(h.state.calls.length, 0);
  h.state.reply = async () => json({ summary_text: 12 }); assert.equal(await summarize('Facts', 500, { allowInference: true }), null);
  h.state.reply = async () => json([{ summary_text: ' Short summary. ' }]); assert.equal(await summarize('Facts', 500, { allowInference: true }), 'Short summary.');
});

test('image generation rejects invalid style and non-image/truncated responses', async () => {
  const h = await harness(); h.enable(); const { generateImage } = await h.api('huggingface/text2image.ts');
  assert.equal(await generateImage({ prompt: 'Race', style: 'invalid', allowInference: true }), null); assert.equal(h.state.calls.length, 0);
  h.state.reply = async () => json({ error: 'not png' }); assert.equal(await generateImage({ prompt: 'Race', allowInference: true }), null);
  h.state.reply = async () => new Response(png.subarray(0, 24), { headers: { 'content-type': 'image/png' } });
  assert.equal(await generateImage({ prompt: 'Race', allowInference: true }), null);
});

test('image output dimensions are measured from the actual PNG, not echoed from requested aspect', async () => {
  const h = await harness(); h.enable(); const { generateImage } = await h.api('huggingface/text2image.ts');
  h.state.reply = async () => new Response(png, { headers: { 'content-type': 'image/png' } });
  const result = await generateImage({ prompt: 'Race', aspect: '16:9', allowInference: true });
  assert.equal(result.width, 1); assert.equal(result.height, 1); assert.equal(result.url, undefined);
});

test('unapproved translation stays unavailable while same-language text preserves the real source', async () => {
  const h = await harness(); h.enable(); const { translate, translateBatchToEnglish } = await h.api('huggingface/translate.ts');
  assert.equal(await translate({ text: 'Ciao', sourceLang: 'it', targetLang: 'en', allowInference: true }), null);
  assert.equal(await translate({ text: ' Facts ', sourceLang: 'en', targetLang: 'en' }), 'Facts');
  const results = await translateBatchToEnglish([{ text: 'Facts', sourceLang: 'en' }, { text: 'Ciao', sourceLang: 'it' }]);
  assert.equal(results[0], 'Facts'); assert.equal(results[1], null); assert.equal(h.state.calls.length, 0);
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions, request } from 'node:https';
import { test } from 'node:test';
import { probeF1MediaAsset, probeRealHeadshot } from './headshot-probe';

const portrait = 'https://media.formula1.com/content/dam/fom-website/drivers/M/MAXVER01_Max_Verstappen/maxver01.png.transform/4col/image.png';
const legacyPortrait = portrait.replace('media.formula1.com', 'www.formula1.com');
const publicAddress: LookupAddress = { address: '151.101.1.91', family: 4 };

function fixture(options: {
  addresses?: LookupAddress[];
  status?: number;
  headers?: Record<string, string | string[] | undefined>;
  requestError?: boolean;
  stalledDns?: boolean;
  stalledRequest?: boolean;
} = {}) {
  const calls: { url: URL; options: RequestOptions }[] = [];
  let resolutions = 0;
  let responseDestroyed = false;
  const lookupImpl = (async () => {
    resolutions += 1;
    if (options.stalledDns) return new Promise<LookupAddress[]>(() => {});
    return options.addresses ?? [publicAddress];
  });
  const requestImpl = ((url: URL, requestOptions: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push({ url, options: requestOptions });
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      if (options.stalledRequest) return;
      queueMicrotask(() => {
        if (options.requestError) { req.emit('error', new Error('fixture transport failed')); return; }
        const response = Object.assign(new EventEmitter(), {
          statusCode: options.status ?? 200,
          headers: options.headers ?? { 'content-type': 'image/png', 'content-length': '12000' },
          destroy: () => { responseDestroyed = true; },
        });
        callback(response as IncomingMessage);
      });
    };
    return req;
  }) as typeof request;
  return { lookupImpl, requestImpl, calls, resolutions: () => resolutions, responseDestroyed: () => responseDestroyed };
}

test('untrusted URL forms return unavailable before DNS or a network request', async () => {
  const f = fixture();
  for (const input of [
    'http://media.formula1.com/photo.png', 'https://127.0.0.1/photo.png', 'https://[::1]/photo.png',
    'https://localhost/photo.png', 'https://unknown.example/photo.png',
    'https://media.formula1.com.attacker.example/photo.png', 'https://sub.media.formula1.com/photo.png',
    'https://user@media.formula1.com/photo.png', 'https://user:password@media.formula1.com/photo.png',
    'https://media.formula1.com:443/photo.png', 'https://media.formula1.com:8443/photo.png',
    `${portrait}#fragment`, ` ${portrait}`, portrait.replace('https://', 'https:\\'),
    `https://media.formula1.com/${'x'.repeat(2_048)}`, 'data:image/png;base64,abcd',
  ]) assert.equal(await probeRealHeadshot(input, f), null, input);
  for (const input of [null, undefined, 123, {}, []]) assert.equal(await probeRealHeadshot(input as unknown as string, f), null);
  assert.equal(f.resolutions(), 0);
  assert.equal(f.calls.length, 0);
});

test('documented F1 hosts use HEAD, the small transform and the checked address while retaining TLS hostname', async () => {
  for (const input of [portrait, legacyPortrait]) {
    const f = fixture({ addresses: [{ address: '2606:4700::1111', family: 6 }, publicAddress] });
    assert.equal(await probeRealHeadshot(input, f), input);
    assert.equal(f.calls.length, 1);
    const call = f.calls[0]!;
    assert.equal(call.url.hostname, new URL(input).hostname);
    assert.match(call.url.pathname, /\.transform\/1col\/image\.png$/);
    assert.equal(call.options.method, 'HEAD');
    assert.equal(call.options.agent, false);
    assert.equal(call.options.rejectUnauthorized, undefined);
    let singleResult: unknown[] = [];
    call.options.lookup!('untrusted-second-resolution.example', { all: false }, (...args: unknown[]) => { singleResult = args; });
    assert.deepEqual(singleResult, [null, publicAddress.address, publicAddress.family]);
    let allResult: unknown[] = [];
    call.options.lookup!('untrusted-second-resolution.example', { all: true }, (...args: unknown[]) => { allResult = args; });
    assert.deepEqual(allResult, [null, [publicAddress]]);
    assert.equal(f.responseDestroyed(), true);
  }
});

test('any private, reserved or mapped DNS answer rejects the whole resolution without connecting', async () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '192.168.1.5', '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) {
    const f = fixture({ addresses: [publicAddress, { address, family: address.includes(':') ? 6 : 4 }] });
    assert.equal(await probeRealHeadshot(portrait, f), null, address);
    assert.equal(f.calls.length, 0);
  }
  const empty = fixture({ addresses: [] });
  assert.equal(await probeRealHeadshot(portrait, empty), null);
  assert.equal(empty.calls.length, 0);
});

test('redirects, missing or invalid image metadata and silhouette sizes cannot become real portraits', async () => {
  for (const status of [201, 301, 302, 307, 308, 404, 500]) {
    const f = fixture({ status });
    assert.equal(await probeRealHeadshot(portrait, f), null);
    assert.equal(f.calls.length, 1);
  }
  for (const headers of [
    {}, { 'content-type': 'image/png' }, { 'content-type': 'text/html', 'content-length': '12000' },
    { 'content-type': 'image/svg+xml', 'content-length': '12000' },
    { 'content-type': 'image/png', 'content-length': '0' },
    { 'content-type': 'image/png', 'content-length': '2500' },
    { 'content-type': 'image/png', 'content-length': '2.6e3' },
    { 'content-type': 'image/png', 'content-length': '-10000' },
    { 'content-type': 'image/png', 'content-length': '20000001' },
    { 'content-type': 'image/png', 'content-length': ['12000', '12000'] },
  ]) assert.equal(await probeRealHeadshot(portrait, fixture({ headers })), null);
  assert.equal(await probeRealHeadshot(portrait, fixture({ headers: { 'content-type': 'image/webp; charset=binary', 'content-length': '2501' } })), portrait);
  const raw = 'https://media.formula1.com/photo.png';
  assert.equal(await probeRealHeadshot(raw, fixture({ headers: { 'content-type': 'image/png', 'content-length': '6000' } })), null);
  assert.equal(await probeRealHeadshot(raw, fixture({ headers: { 'content-type': 'image/png', 'content-length': '6001' } })), raw);
});

test('DNS and HTTPS failures are bounded and produce unavailable portraits', async () => {
  assert.equal(await probeRealHeadshot(portrait, fixture({ requestError: true })), null);
  for (const options of [{ stalledDns: true }, { stalledRequest: true }]) {
    const f = fixture(options);
    const start = performance.now();
    assert.equal(await probeRealHeadshot(portrait, { ...f, timeoutMs: 20 }), null);
    assert.ok(performance.now() - start < 500);
    assert.equal(f.calls.length, options.stalledDns ? 0 : 1);
    if (f.calls[0]) assert.equal(f.calls[0].options.signal?.aborted, true);
  }
});

test('a DNS result arriving after the deadline never starts a later HTTPS connection', async () => {
  const f = fixture();
  let release!: (addresses: LookupAddress[]) => void;
  const lookupImpl = () => new Promise<LookupAddress[]>(resolve => { release = resolve; });
  assert.equal(await probeRealHeadshot(portrait, { ...f, lookupImpl, timeoutMs: 10 }), null);
  release([publicAddress]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
});

test('F1 media CDN assets: untransformed HEAD, media host only, SVG logos admitted only when asked', async () => {
  const cutout = 'https://media.formula1.com/image/upload/common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01right.webp';
  const f = fixture({ headers: { 'content-type': 'image/avif', 'content-length': '107430' } });
  assert.equal(await probeF1MediaAsset(cutout, { minBytes: 20_000 }, f), cutout);
  assert.equal(f.calls[0]!.url.href, cutout);
  assert.equal(f.calls[0]!.options.method, 'HEAD');
  assert.equal(await probeF1MediaAsset(cutout, { minBytes: 20_000 }, fixture({ status: 404, headers: { 'content-type': 'application/octet-stream' } })), null);
  assert.equal(await probeF1MediaAsset(cutout.replace('media.formula1.com', 'www.formula1.com'), { minBytes: 1 }, fixture()), null);
  const logo = 'https://media.formula1.com/image/upload/common/f1/2026/mclaren/2026mclarenlogowhite.svg';
  // The CDN streams SVG without a content-length.
  assert.equal(await probeF1MediaAsset(logo, { minBytes: 100, allowSvg: true }, fixture({ headers: { 'content-type': 'image/svg+xml' } })), logo);
  assert.equal(await probeF1MediaAsset(logo, { minBytes: 100 }, fixture({ headers: { 'content-type': 'image/svg+xml' } })), null);
  assert.equal(await probeF1MediaAsset(logo, { minBytes: 100, allowSvg: true }, fixture({ headers: { 'content-type': 'image/png' } })), null);
});

test('D2-CODE-QUALITY-6: inconclusive probes throw (not cacheable); definitive misses return null', async () => {
  const { probeF1MediaAssetStrict, ProbeTransientError } = await import('./headshot-probe');
  const publicDns = async () => [{ address: '151.101.1.1', family: 4 }];
  const url = 'https://media.formula1.com/image/upload/c_lfill,w_1000/q_auto/v1740000000/common/f1/2026/mclaren/lannor01/2026mclarenlannor01right.webp';
  const respond = (statusCode: number, headers: Record<string, string> = {}) => ((_url: unknown, _options: unknown, callback: (response: unknown) => void) => {
    const response = { statusCode, headers, on: () => response, destroy: () => undefined };
    queueMicrotask(() => callback(response));
    return { on: () => undefined, end: () => undefined };
  }) as never;
  await assert.rejects(probeF1MediaAssetStrict(url, { minBytes: 100 }, { lookupImpl: publicDns as never, requestImpl: respond(503) }), ProbeTransientError);
  await assert.rejects(probeF1MediaAssetStrict(url, { minBytes: 100 }, { lookupImpl: async () => { throw new Error('ENOTFOUND'); }, requestImpl: respond(200) }), ProbeTransientError);
  await assert.rejects(probeF1MediaAssetStrict(url, { minBytes: 100 }, { lookupImpl: () => new Promise(() => {}), timeoutMs: 5 }), ProbeTransientError);
  assert.equal(await probeF1MediaAssetStrict(url, { minBytes: 100 }, { lookupImpl: publicDns as never, requestImpl: respond(404) }), null);
  assert.equal(await probeF1MediaAssetStrict(url, { minBytes: 100 }, { lookupImpl: publicDns as never, requestImpl: respond(200, { 'content-type': 'image/webp', 'content-length': '50000' }) }), url);
});

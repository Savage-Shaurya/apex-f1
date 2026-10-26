import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRegion, isOnTopicForChannel, pickFeatured, playerAttributes, spokenDuration, toVideoView } from './video-model';

const base = { videoId: 'abcdefghijk', title: 'Qualifying Highlights &amp; reaction', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnailUrl: '', channelName: 'FORMULA 1', publishedAt: '2026-10-25T10:00:00Z', publishedMs: Date.parse('2026-10-25T10:00:00Z') };

test('RSS-path videos show no invented duration or views', () => {
  const v = toVideoView(base);
  assert.equal(v.title, 'Qualifying Highlights & reaction');
  assert.equal(v.duration, null);
  assert.equal(v.views, null);
  assert.equal(v.thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  assert.equal(v.embeddable, true);
  assert.equal(playerAttributes(v)['data-apex-video-id'], 'abcdefghijk');
});

test('enriched videos carry YouTube facts; hidden counts are said plainly; blocked videos open at YouTube', () => {
  const enriched = { ...base, enriched: true as const, channelId: 'c', channelThumbnail: '', channelSubscriberCount: null, durationSeconds: 754, viewCount: null, likeCount: null, commentCount: null, description: '', embeddable: false, privacyStatus: 'public' as const, regionBlocked: false };
  const v = toVideoView(enriched);
  assert.equal(v.duration, '12:34');
  assert.equal(v.durationSpoken, '12 minutes 34 seconds');
  assert.equal(v.views, 'Views hidden by YouTube');
  assert.equal(v.embeddable, false);
  assert.equal(playerAttributes(v)['data-apex-video-id'], undefined);
  assert.equal(toVideoView({ ...enriched, viewCount: 2500, embeddable: true }).views, '2.5K views');
});

test('bad ids never reach the player; spoken durations', () => {
  assert.equal(toVideoView({ ...base, videoId: 'not an id' }).embeddable, false);
  assert.equal(spokenDuration(3725), '1 hour 2 minutes');
  assert.equal(spokenDuration(61), '1 minute 1 second');
  assert.equal(spokenDuration(0), null);
});

test('a video at 0 views (stream or premiere not started) prints no view count', () => {
  const live = { ...base, enriched: true as const, channelId: 'c', channelThumbnail: '', channelSubscriberCount: null, durationSeconds: 0, viewCount: 0, likeCount: null, commentCount: null, description: '', embeddable: true, privacyStatus: 'public' as const, regionBlocked: false };
  const v = toVideoView(live);
  assert.equal(v.views, null);
  assert.equal(v.duration, null);
  assert.equal(v.regionLimited, false);
  assert.equal(toVideoView({ ...live, regionRestriction: { allowed: ['GB'] } }).regionLimited, true);
  assert.equal(toVideoView({ ...live, regionRestriction: { blocked: ['US'] } }).regionLimited, true);
});

test('the featured video is one (nearly) every reader can play', () => {
  const limited = { widelyPlayable: false, duration: '3:00', id: 'limited' };
  const live = { widelyPlayable: true, duration: null, id: 'live' };
  const ok = { widelyPlayable: true, duration: '9:00', id: 'ok' };
  assert.equal(pickFeatured([limited, live, ok])?.id, 'ok');
  assert.equal(pickFeatured([limited, live])?.id, 'live');
  assert.equal(pickFeatured([limited])?.id, 'limited');
  assert.equal(pickFeatured([]), undefined);
});

test('region limits: F1 uploads blocked in two countries still lead; allow-listed broadcaster clips do not', () => {
  const enriched = { ...base, enriched: true as const, channelId: 'c', channelThumbnail: '', channelSubscriberCount: null, durationSeconds: 90, viewCount: 152000, likeCount: null, commentCount: null, description: '', embeddable: true, privacyStatus: 'public' as const, regionBlocked: false };
  // Real shapes from 25 Oct 2026: FORMULA 1 blocks BY and RU; Sky Sports F1 allows six countries.
  const f1 = toVideoView({ ...enriched, regionRestriction: { blocked: ['RU', 'BY'] } });
  assert.equal(f1.widelyPlayable, true);
  assert.equal(f1.regionNote, 'Not available in Belarus and Russia');
  const sky = toVideoView({ ...enriched, channelName: 'Sky Sports F1', regionRestriction: { allowed: ['GB', 'IE', 'IT', 'DE', 'AT', 'CH'] } });
  assert.equal(sky.widelyPlayable, false);
  assert.equal(sky.regionNote, 'Plays in only 6 countries');
  assert.equal(toVideoView(enriched).regionNote, null);
  assert.equal(toVideoView(enriched).widelyPlayable, true);
  assert.equal(toVideoView({ ...enriched, embeddable: false }).widelyPlayable, false);
  const many = toVideoView({ ...enriched, regionRestriction: { blocked: ['US', 'GB', 'FR', 'DE', 'IT', 'ES'] } });
  assert.equal(many.widelyPlayable, false);
  assert.equal(many.regionNote, 'Not available in 6 countries');
  assert.equal(describeRegion({ allowed: ['GB'] }), 'Plays in only 1 country');
  assert.equal(describeRegion(undefined, true), 'Not available in some countries');
  assert.equal(pickFeatured([sky, f1]), f1);
});

test('broad channels need an F1 signal; F1 channels do not', () => {
  assert.equal(isOnTopicForChannel("The Insane Engineering of the World's Fastest Car", 'driver61'), false);
  assert.equal(isOnTopicForChannel('Why Mercedes Suddenly Found Pace in Austin', 'driver61'), true);
  assert.equal(isOnTopicForChannel('How F1 cars generate downforce', 'driver61'), true);
  assert.equal(isOnTopicForChannel('Instant reaction', 'sky-sports-f1'), true);
  assert.equal(isOnTopicForChannel('Anything', undefined), true);
});

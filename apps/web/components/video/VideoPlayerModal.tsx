'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';
import { captureClient } from '@/lib/analytics';
import { ModalDialog } from '@/components/shell/ModalDialog';
import { isVideoEntry, playerOutlivedPage, videoEntryOf, videoEntryState, type VideoEntry } from './video-history';

type PlayerState = 'loading' | 'loaded' | 'slow' | 'error';

/** Status copy for each player state. Exported for tests: nothing claims playback YouTube did not confirm. */
export const PLAYER_STATUS: Record<PlayerState, string> = {
  loading: 'Loading the YouTube player.',
  slow: 'The player is taking longer than usual. You can open this video at YouTube instead.',
  error: 'The player could not be loaded. Open this video at YouTube instead.',
  loaded: 'Player loaded. If YouTube says the video is unavailable here, open it at YouTube.',
};

/**
 * The site-wide video player, the screening room's screen. Any link carrying
 * `data-apex-video-id` (an 11-character YouTube id) opens here in a native
 * modal dialog (focus contained, Escape closes, focus returns to the card).
 * The house lights dim, the screen rises a few pixels into place, and the
 * video's own poster fills it until YouTube's player has loaded, then the
 * player fades in over it: no black flash, no jump. The privacy-enhanced
 * youtube-nocookie embed is used; every state says what is happening and
 * offers YouTube itself as the way out.
 *
 * History: opening pushes one same-URL entry; Back pops it and closes the
 * player, and the close button pops it too. Back or Forward onto that entry
 * later steps over it instead of reopening the video: overlays never reopen
 * from history (quality gate), and the reader never lands on a dead step. A
 * route change under the player closes it, so a video never keeps playing
 * (with the page scroll locked) over another page.
 */
export function VideoPlayerModal() {
  const [video, setVideo] = useState<VideoEntry | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const reduce = useReducedMotion();
  const pathname = usePathname();
  /** Id of the history entry this player pushed (or reopened) and has not popped yet. */
  const pushed = useRef<string | null>(null);

  const close = useCallback(() => {
    setVideo(null);
    const id = pushed.current;
    pushed.current = null;
    // Pop the player's own entry so Back afterwards goes where the reader expects.
    if (id && isVideoEntry(window.history.state, id)) window.history.back();
  }, []);

  // One history entry per opened video; Back pops it and closes the player.
  const videoId = video?.id;
  const meta = video ? { title: video.title, channel: video.channel, poster: video.poster } : null;
  const metaRef = useRef(meta);
  useEffect(() => { metaRef.current = meta; });
  useEffect(() => {
    if (!videoId) return;
    if (pushed.current !== videoId) {
      window.history.pushState(videoEntryState(videoId, metaRef.current ?? {}), '');
      pushed.current = videoId;
    }
    function onPopState() {
      if (isVideoEntry(window.history.state, videoId!)) return;
      pushed.current = null;
      setVideo(null);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [videoId]);

  // Closed: Back/Forward onto a player entry this page left behind steps over it
  // (one more step the same way) instead of reopening the video.
  useEffect(() => {
    if (videoId) return;
    function onPopState() {
      if (!videoEntryOf(window.history.state)) return;
      // Forward landed on the closed player's entry: there is nothing after it on
      // this page, so go back over it; Back landed on it: keep going back.
      window.history.back();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [videoId]);

  // Safety net: if the route changes under the player by any other path, close it
  // (state adjusted during render, so the stale player never paints on the new page).
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    if (playerOutlivedPage(shownOn, pathname) && video) setVideo(null);
  }
  // A closed player owns no history entry.
  useEffect(() => { if (!videoId) pushed.current = null; }, [videoId]);

  useEffect(() => {
    if (!video) return;
    const timer = window.setTimeout(() => {
      setPlayerState((current) => (current === 'loading' ? 'slow' : current));
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [video]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const trigger = event.target.closest<HTMLElement>('[data-apex-video-id]');
      const id = trigger?.getAttribute('data-apex-video-id');
      if (!trigger || !id || !/^[\w-]{11}$/.test(id)) return;
      event.preventDefault();
      trigger.focus({ preventScroll: true });
      setPlayerState('loading');
      setVideo({
        id,
        title: trigger.getAttribute('data-apex-video-title') ?? '',
        channel: trigger.getAttribute('data-apex-video-channel') ?? '',
        poster: trigger.getAttribute('data-apex-video-poster') ?? '',
      });
      captureClient('video_play', { videoId: id });
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  if (!video) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const poster = /^https:\/\/i\d?\.ytimg\.com\//.test(video.poster) ? video.poster : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  const loaded = playerState === 'loaded';

  return (
    <ModalDialog label={video.title || 'Video player'} onClose={close}>
      <div className="relative flex min-h-dvh items-center justify-center px-3 py-6 text-[#f4f5f7] md:px-8">
        <m.button
          type="button"
          onClick={close}
          tabIndex={-1}
          aria-label="Close video player"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 cursor-default bg-[#050506]/[0.93]"
        />
        {/* The projector: a cool pool of light falling on the screen from above. */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_45%_70%_at_50%_-10%,rgb(233_240_255/0.12),transparent_70%)]" />
        <m.div
          initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full min-w-[min(100%,20rem)] max-w-[min(76rem,calc((100dvh-14rem)*16/9))]"
        >
          <header className="flex items-start justify-between gap-4 pb-4">
            <div className="min-w-0 flex-1">
              {video.channel && <p className="flex items-center gap-3 text-[0.75rem] font-[650] uppercase leading-tight tracking-[0.12em] text-[#c9ccd3]"><span aria-hidden className="h-[2px] w-8 bg-[#e10600]" />{video.channel}</p>}
              <h2 className="mt-2 text-[clamp(1.1rem,0.9rem+0.9vw,1.6rem)] font-semibold leading-snug [overflow-wrap:anywhere]">{video.title || 'Formula 1 video'}</h2>
            </div>
            <button
              type="button"
              onClick={close}
              autoFocus
              aria-label="Close video player"
              className="grid size-11 shrink-0 place-items-center rounded-full text-white ring-1 ring-white/25 transition-[background-color,transform] duration-300 hover:bg-white/10 active:scale-95 motion-reduce:transform-none"
            >
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </header>
          <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black shadow-[0_40px_120px_-40px_rgb(233_240_255/0.25)] ring-1 ring-white/12">
            {/* The poster holds the screen until the player is ready (a 16:9 picture, so cover only trims letterbox bars). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poster} alt="" aria-hidden className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-700', loaded ? 'opacity-0' : 'opacity-60')} />
            {!loaded && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/10">
                <span className={cn('block h-full w-1/3 bg-[linear-gradient(90deg,transparent,#e9f0ff,transparent)]', !reduce && 'animate-[apex-player-line_1.4s_ease-in-out_infinite]')} />
              </div>
            )}
            <iframe
              key={video.id}
              src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`}
              title={video.title || 'YouTube video player'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setPlayerState('loaded')}
              onError={() => setPlayerState('error')}
              className={cn('absolute inset-0 h-full w-full transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
            />
          </div>
          <footer className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p role="status" aria-live="polite" className="text-[0.9rem] text-[#c9ccd3]">{PLAYER_STATUS[playerState]}</p>
            <div className="flex shrink-0 items-center gap-3">
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] font-medium ring-1 ring-white/30 transition-colors hover:bg-white/[0.06] hover:ring-white/60">
                Open at YouTube <span aria-hidden>↗</span><span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button type="button" onClick={close} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#f4f5f7] px-5 text-[0.9rem] font-semibold text-[#050506] transition-transform duration-300 active:scale-[0.96] motion-reduce:transform-none">
                Close <kbd className="font-timing text-[0.72rem] text-[#3d3f46]">Esc</kbd>
              </button>
            </div>
          </footer>
        </m.div>
      </div>
      <style>{'@keyframes apex-player-line{from{transform:translateX(-100%)}to{transform:translateX(300%)}}'}</style>
    </ModalDialog>
  );
}

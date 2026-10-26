/** Both operator CLI and deployed cron use the same bounded, fenced sync contract. */
export { syncRecentYouTubeUploads, youtubeSyncReaders, type YouTubeSyncDependencies } from '../../workers/src/lib/youtube-sync';

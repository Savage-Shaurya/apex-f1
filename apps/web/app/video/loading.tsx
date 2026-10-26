import { StreamSkeleton } from '@/components/news/StreamSkeleton';

export default function VideoLoading() {
  return <StreamSkeleton label="Loading the latest Formula 1 videos" rows={5} />;
}

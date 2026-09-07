export interface YouTubeSubtitle {
  sentence: string;
  url: string;
  title: string;
}

const YOUTUBE_HOST = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

export function captureYouTubeSubtitle(node: Node, pause = true): YouTubeSubtitle | null {
  if (!YOUTUBE_HOST.test(location.hostname)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const caption = element?.closest('.ytp-caption-segment, .ytp-caption-window-container');
  const video = caption?.closest('.html5-video-player')?.querySelector<HTMLVideoElement>('video');
  if (!caption || !video) return null;

  const container = caption.closest('.ytp-caption-window-container') ?? caption;
  const sentence = [...container.querySelectorAll('.ytp-caption-segment')]
    .map((segment) => segment.textContent?.trim()).filter(Boolean).join(' ').trim()
    || container.textContent?.trim() || '';
  if (!sentence) return null;

  if (!Number.isFinite(video.currentTime)) return null;
  const seconds = Math.max(0, Math.floor(video.currentTime));
  const url = new URL(location.href);
  url.searchParams.set('t', `${seconds}s`);
  if (pause) video.pause();
  return { sentence, url: url.toString(), title: `${document.title} · ${formatTime(seconds)}` };
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

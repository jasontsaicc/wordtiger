import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureYouTubeSubtitle } from './youtube';

describe('YouTube 字幕來源', () => {
  let originalTitle = '';
  beforeEach(() => { originalTitle = document.title; });
  afterEach(() => {
    document.body.innerHTML = '';
    document.title = originalTitle;
    vi.unstubAllGlobals();
  });
  it('只接受 YouTube 字幕節點,並暫停影片、固定時間 URL 與標題', () => {
    document.body.innerHTML = `
      <div class="html5-video-player"><video class="html5-main-video"></video>
        <div class="ytp-caption-window-container"><span class="ytp-caption-segment">Hello there</span></div>
      </div>
    `;
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 125.8 });
    Object.defineProperty(video, 'pause', { configurable: true, value: () => { video.dataset.paused = 'yes'; } });
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abc'));
    document.title = 'A video';

    expect(captureYouTubeSubtitle(document.querySelector('span')!)).toEqual({
      url: 'https://www.youtube.com/watch?v=abc&t=125s',
      title: 'A video · 2:05',
      sentence: 'Hello there',
    });
    expect(video.dataset.paused).toBe('yes');
    vi.stubGlobal('location', new URL('https://example.com/watch?v=abc'));
    expect(captureYouTubeSubtitle(document.querySelector('span')!)).toBeNull();
  });

  it('不把普通文章文字當成影片字幕', () => {
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abc'));
    document.body.innerHTML = '<div class="html5-video-player"><video></video><p>Hello there</p></div>';
    expect(captureYouTubeSubtitle(document.querySelector('p')!.firstChild!)).toBeNull();
  });

  it('影片時間不是有限數字時不產生來源', () => {
    document.body.innerHTML = '<div class="html5-video-player"><video></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment">Hello</span></div></div>';
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abc'));
    Object.defineProperty(document.querySelector('video'), 'currentTime', { configurable: true, value: Number.NaN });
    expect(captureYouTubeSubtitle(document.querySelector('span')!)).toBeNull();
  });
});

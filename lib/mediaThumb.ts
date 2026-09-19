/**
 * Helpers for grid / cover thumbnails.
 * Never feed a video URL (.mp4 etc.) to <Image />.
 */

const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|qt)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif)(\?|#|$)/i;

export function isLikelyVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return VIDEO_EXT_RE.test(url);
}

export function isLikelyImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isLikelyVideoUrl(url)) return false;
  if (IMAGE_EXT_RE.test(url)) return true;
  // data: / blob: local previews from ImagePicker are fine for Image
  if (url.startsWith('data:image/') || url.startsWith('file:') || url.startsWith('content:')) {
    return true;
  }
  // picsum / pravatar / common CDN image hosts without extension
  if (/picsum\.photos|pravatar\.cc|i\.pravatar\.cc|images\.unsplash\.com/i.test(url)) {
    return true;
  }
  return false;
}

/**
 * URL safe to pass to <Image /> for grids.
 * Returns null when we should show the NIA placeholder instead.
 */
export function resolveGridThumbUrl(input: {
  thumbnailUrl?: string | null;
  mediaType?: 'video' | 'image' | null;
  videoUrl?: string | null;
}): string | null {
  const thumb = input.thumbnailUrl?.trim() || '';
  if (thumb && isLikelyImageUrl(thumb)) return thumb;
  if (thumb && isLikelyVideoUrl(thumb)) return null;

  if (input.mediaType === 'image') {
    const fallback = input.videoUrl?.trim() || '';
    if (fallback && isLikelyImageUrl(fallback)) return fallback;
    // image media whose public URL has no extension — still try (storage image)
    if (fallback && !isLikelyVideoUrl(fallback)) return fallback;
  }

  // leftover thumb without clear type — only use if not video-looking
  if (thumb && !isLikelyVideoUrl(thumb) && input.mediaType !== 'video') {
    return thumb;
  }
  return null;
}

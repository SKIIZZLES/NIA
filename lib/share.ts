/**
 * Partage natif (Share API) — caption + lien stub nia.app.
 */
import { Share, Platform } from 'react-native';
import type { VideoItem } from '@/data/mockVideos';

export function buildShareMessage(item: VideoItem): string {
  const handle = item.handle.startsWith('@') ? item.handle : `@${item.handle}`;
  const caption = (item.caption || '').trim();
  const link = `https://nia.app/v/${encodeURIComponent(item.id)}`;
  const lines = [
    caption ? caption : 'Découvre cette vidéo sur NIA',
    `${handle} · NIA`,
    link,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function shareVideo(item: VideoItem): Promise<boolean> {
  const message = buildShareMessage(item);
  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { message, url: `https://nia.app/v/${encodeURIComponent(item.id)}` }
        : { message, title: 'NIA' },
    );
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}

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

export function buildEventShareMessage(input: {
  id: string;
  title: string;
  city?: string | null;
  startsAt: string;
}): string {
  const when = new Date(input.startsAt);
  const whenLabel = Number.isNaN(when.getTime())
    ? input.startsAt
    : when.toLocaleString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
  const link = `https://nia.app/e/${encodeURIComponent(input.id)}`;
  const lines = [
    input.title,
    input.city ? `${input.city} · ${whenLabel}` : whenLabel,
    'NIA · Événements',
    link,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function shareEvent(input: {
  id: string;
  title: string;
  city?: string | null;
  startsAt: string;
}): Promise<boolean> {
  const message = buildEventShareMessage(input);
  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? {
            message,
            url: `https://nia.app/e/${encodeURIComponent(input.id)}`,
          }
        : { message, title: 'NIA' },
    );
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}

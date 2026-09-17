import type { CategoryId } from '@/constants/categories';

export type VideoItem = {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  handle: string;
  caption: string;
  likes: number;
  comments: number;
  shares: number;
  avatarUrl: string;
  tab: 'pour-toi' | 'abonnements' | 'afrique' | 'decouvrir';
  country?: string;
  /** Aligné Découvrir / videos.category */
  category?: CategoryId;
};

/** Démos publiques (Big Buck Bunny / samples) — à remplacer par CDN NIA */
export const DEMO_VIDEOS: VideoItem[] = [
  {
    id: '1',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia1/540/960',
    handle: '@aminata.dakar',
    caption: 'Rythmes du marché — Dakar 🌅 #culture #senegal',
    likes: 12400,
    comments: 342,
    shares: 1100,
    avatarUrl: 'https://i.pravatar.cc/150?u=aminata',
    tab: 'pour-toi',
    country: 'Sénégal',
    category: 'culture',
  },
  {
    id: '2',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia2/540/960',
    handle: '@kwame.accra',
    caption: 'Street style Accra — talents sans frontières ✨',
    likes: 8900,
    comments: 210,
    shares: 640,
    avatarUrl: 'https://i.pravatar.cc/150?u=kwame',
    tab: 'pour-toi',
    country: 'Ghana',
    category: 'mode',
  },
  {
    id: '3',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia3/540/960',
    handle: '@fatou.abidjan',
    caption: 'Danse traditionnelle revisitée 🥁 #afrique',
    likes: 22100,
    comments: 891,
    shares: 2300,
    avatarUrl: 'https://i.pravatar.cc/150?u=fatou',
    tab: 'afrique',
    country: "Côte d'Ivoire",
    category: 'afrique',
  },
  {
    id: '4',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia4/540/960',
    handle: '@sofia.casa',
    caption: 'Sunset médina — cultures qui voyagent 🌍',
    likes: 5600,
    comments: 128,
    shares: 390,
    avatarUrl: 'https://i.pravatar.cc/150?u=sofia',
    tab: 'decouvrir',
    country: 'Maroc',
    category: 'diaspora',
  },
  {
    id: '5',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia5/540/960',
    handle: '@jean.kinshasa',
    caption: 'Beat makers de Kin — la scène monte 🔥',
    likes: 15300,
    comments: 456,
    shares: 980,
    avatarUrl: 'https://i.pravatar.cc/150?u=jean',
    tab: 'abonnements',
    country: 'RDC',
    category: 'musique',
  },
  {
    id: '6',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    thumbnailUrl: 'https://picsum.photos/seed/nia6/540/960',
    handle: '@nana.lagos',
    caption: 'Afrobeats vibes — Lagos nights 🎵',
    likes: 31000,
    comments: 1200,
    shares: 4500,
    avatarUrl: 'https://i.pravatar.cc/150?u=nana',
    tab: 'pour-toi',
    country: 'Nigeria',
    category: 'musique',
  },
];

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

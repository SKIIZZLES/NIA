import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { DEMO_VIDEOS, VideoItem } from '@/data/mockVideos';
import { useAuth } from './AuthContext';

type FeedContextValue = {
  videos: VideoItem[];
  addLocalPost: (caption: string, thumbnailUrl?: string) => void;
  toggleLike: (id: string) => void;
  likedIds: Set<string>;
};

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [videos, setVideos] = useState<VideoItem[]>(DEMO_VIDEOS);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const addLocalPost = useCallback(
    (caption: string, thumbnailUrl?: string) => {
      const handle = user ? `@${user.username}` : '@moi';
      const item: VideoItem = {
        id: `local_${Date.now()}`,
        videoUrl:
          'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        thumbnailUrl: thumbnailUrl || 'https://picsum.photos/seed/localnia/540/960',
        handle,
        caption: caption || 'Nouvelle vidéo NIA ✨',
        likes: 0,
        comments: 0,
        shares: 0,
        avatarUrl: user?.avatarUrl || 'https://i.pravatar.cc/150?u=moi',
        tab: 'pour-toi',
      };
      setVideos((prev) => [item, ...prev]);
    },
    [user],
  );

  const toggleLike = useCallback((id: string) => {
    setLikedIds((prev) => {
      const next = new Set(prev);
      const wasLiked = next.has(id);
      if (wasLiked) next.delete(id);
      else next.add(id);
      setVideos((vids) =>
        vids.map((v) =>
          v.id === id
            ? { ...v, likes: Math.max(0, v.likes + (wasLiked ? -1 : 1)) }
            : v,
        ),
      );
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ videos, addLocalPost, toggleLike, likedIds }),
    [videos, addLocalPost, toggleLike, likedIds],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeed(): FeedContextValue {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error('useFeed doit être utilisé dans FeedProvider');
  return ctx;
}

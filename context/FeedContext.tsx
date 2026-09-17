import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DEMO_VIDEOS, VideoItem } from '@/data/mockVideos';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  fetchVideosFromSupabase,
  uploadVideoToSupabase,
} from '@/lib/videos';

type PublishInput = {
  caption: string;
  localUri?: string;
  mimeType?: string | null;
  region?: string;
  tag?: string;
};

type FeedContextValue = {
  videos: VideoItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Mock local ou upload Supabase selon config */
  publishPost: (input: PublishInput) => Promise<void>;
  /** @deprecated préférer publishPost */
  addLocalPost: (caption: string, thumbnailUrl?: string) => void;
  toggleLike: (id: string) => void;
  likedIds: Set<string>;
  isMockFeed: boolean;
};

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const mockFeed = !isSupabaseConfigured;
  const [videos, setVideos] = useState<VideoItem[]>(DEMO_VIDEOS);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setVideos(DEMO_VIDEOS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchVideosFromSupabase();
      setVideos(remote.length ? remote : DEMO_VIDEOS);
    } catch {
      // garde démos si API down
      setVideos((prev) => (prev.length ? prev : DEMO_VIDEOS));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const publishPost = useCallback(
    async (input: PublishInput) => {
      if (!isSupabaseConfigured || !user || user.id.startsWith('mock_')) {
        addLocalPost(input.caption, input.localUri);
        return;
      }
      if (!input.localUri) {
        throw new Error('Sélectionnez un média à publier.');
      }
      const item = await uploadVideoToSupabase({
        userId: user.id,
        localUri: input.localUri,
        caption: input.caption,
        region: input.region,
        tag: input.tag,
        mimeType: input.mimeType,
        username: user.username,
        avatarUrl: user.avatarUrl,
      });
      setVideos((prev) => [item, ...prev.filter((v) => v.id !== item.id)]);
    },
    [user, addLocalPost],
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
    () => ({
      videos,
      loading,
      refresh,
      publishPost,
      addLocalPost,
      toggleLike,
      likedIds,
      isMockFeed: mockFeed,
    }),
    [videos, loading, refresh, publishPost, addLocalPost, toggleLike, likedIds, mockFeed],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeed(): FeedContextValue {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error('useFeed doit être utilisé dans FeedProvider');
  return ctx;
}

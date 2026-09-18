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
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  PUBLISH_ERRORS,
  parseHashtags,
} from '@/constants/publish';
import { fetchLikedVideoIds, toggleLike as persistToggleLike } from '@/lib/likes';
import {
  fetchFollowingIds,
  toggleFollow as persistToggleFollow,
} from '@/lib/follows';
import {
  blockUser as persistBlockUser,
  fetchBlockedIds,
  type BlockResult,
} from '@/lib/blocks';

type PublishInput = {
  caption: string;
  localUri?: string;
  mimeType?: string | null;
  region?: string;
  tag?: string;
  category?: string;
  hashtags?: string[];
  fileSize?: number;
  durationMs?: number;
};

type FeedContextValue = {
  videos: VideoItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  publishPost: (input: PublishInput) => Promise<void>;
  /** @deprecated préférer publishPost */
  addLocalPost: (caption: string, thumbnailUrl?: string) => void;
  toggleLike: (id: string) => void;
  likedIds: Set<string>;
  followingIds: Set<string>;
  toggleFollow: (targetUserId: string) => void;
  blockedIds: Set<string>;
  blockUser: (targetUserId: string) => Promise<BlockResult>;
  bumpCommentCount: (videoId: string, delta?: number) => void;
  isMockFeed: boolean;
  feedError: string | null;
};

const FeedContext = createContext<FeedContextValue | null>(null);

function isPersistableId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function filterBlocked(list: VideoItem[], blocked: Set<string>): VideoItem[] {
  if (!blocked.size) return list;
  return list.filter((v) => !v.userId || !blocked.has(v.userId));
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const mockFeed = !isSupabaseConfigured;
  // Real mode starts empty (no demo injection). Mock mode seeds DEMO_VIDEOS.
  const [rawVideos, setRawVideos] = useState<VideoItem[]>(
    isSupabaseConfigured ? [] : DEMO_VIDEOS,
  );
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [feedError, setFeedError] = useState<string | null>(null);

  const videos = useMemo(
    () => filterBlocked(rawVideos, blockedIds),
    [rawVideos, blockedIds],
  );

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRawVideos(DEMO_VIDEOS);
      setFeedError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFeedError(null);
    try {
      const remote = await fetchVideosFromSupabase();
      // Empty table = empty feed (do NOT inject DEMO_VIDEOS in real mode).
      setRawVideos(remote);
      if (user && !user.id.startsWith('mock_')) {
        try {
          const [liked, following, blocked] = await Promise.all([
            fetchLikedVideoIds(user.id),
            fetchFollowingIds(user.id),
            fetchBlockedIds(user.id),
          ]);
          setLikedIds(new Set(liked));
          setFollowingIds(new Set(following));
          setBlockedIds(new Set(blocked));
        } catch {
          // ignore hydrate errors — ne pas crasher l'UI
        }
      }
    } catch {
      // Keep previous remote list if any; never inject demo while configured.
      setFeedError(
        'Connexion limitée. Impossible de charger le feed Supabase.',
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
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
        userId: user?.id,
      };
      setRawVideos((prev) => [item, ...prev]);
    },
    [user],
  );

  const publishPost = useCallback(
    async (input: PublishInput) => {
      if (input.fileSize != null && input.fileSize > MAX_UPLOAD_BYTES) {
        throw new Error(PUBLISH_ERRORS.tooLarge);
      }
      if (
        input.durationMs != null &&
        input.durationMs > MAX_VIDEO_DURATION_SEC * 1000
      ) {
        throw new Error(PUBLISH_ERRORS.tooLong);
      }

      const tags =
        input.hashtags?.length
          ? input.hashtags
          : parseHashtags(input.caption || '');

      if (!isSupabaseConfigured || !user || user.id.startsWith('mock_')) {
        const handle = user ? `@${user.username}` : '@moi';
        const item: VideoItem = {
          id: `local_${Date.now()}`,
          videoUrl:
            'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          thumbnailUrl:
            input.localUri || 'https://picsum.photos/seed/localnia/540/960',
          handle,
          caption: input.caption || 'Nouvelle vidéo NIA ✨',
          likes: 0,
          comments: 0,
          shares: 0,
          avatarUrl: user?.avatarUrl || 'https://i.pravatar.cc/150?u=moi',
          tab: 'pour-toi',
          userId: user?.id,
          category: input.category as VideoItem['category'],
        };
        setRawVideos((prev) => [item, ...prev]);
        return;
      }
      if (!input.localUri) {
        throw new Error(PUBLISH_ERRORS.noMedia);
      }
      try {
        const item = await uploadVideoToSupabase({
          userId: user.id,
          localUri: input.localUri,
          caption: input.caption,
          region: input.region,
          tag: input.tag,
          category: input.category,
          hashtags: tags,
          mimeType: input.mimeType,
          username: user.username,
          avatarUrl: user.avatarUrl,
          status: 'published',
        });
        setRawVideos((prev) => [item, ...prev.filter((v) => v.id !== item.id)]);
      } catch (e) {
        const msg =
          e instanceof Error && e.message
            ? e.message
            : 'Publication impossible. Vérifiez votre connexion.';
        throw new Error(
          msg.includes('fetch') || msg.includes('network')
            ? 'Supabase hors ligne. Réessayez ou publiez en mode mock.'
            : msg,
        );
      }
    },
    [user],
  );

  const toggleLike = useCallback(
    (id: string) => {
      const wasLiked = likedIds.has(id);

      setLikedIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(id);
        else next.add(id);
        return next;
      });
      setRawVideos((vids) =>
        vids.map((v) =>
          v.id === id
            ? { ...v, likes: Math.max(0, v.likes + (wasLiked ? -1 : 1)) }
            : v,
        ),
      );

      if (
        isSupabaseConfigured &&
        user &&
        !user.id.startsWith('mock_') &&
        isPersistableId(id)
      ) {
        void persistToggleLike(user.id, id, wasLiked).catch(() => {
          setLikedIds((prev) => {
            const next = new Set(prev);
            if (wasLiked) next.add(id);
            else next.delete(id);
            return next;
          });
          setRawVideos((vids) =>
            vids.map((v) =>
              v.id === id
                ? { ...v, likes: Math.max(0, v.likes + (wasLiked ? 1 : -1)) }
                : v,
            ),
          );
        });
      }
    },
    [user, likedIds],
  );

  const toggleFollow = useCallback(
    (targetUserId: string) => {
      if (!targetUserId || (user && targetUserId === user.id)) return;
      const wasFollowing = followingIds.has(targetUserId);

      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (wasFollowing) next.delete(targetUserId);
        else next.add(targetUserId);
        return next;
      });

      if (
        isSupabaseConfigured &&
        user &&
        !user.id.startsWith('mock_') &&
        isPersistableId(targetUserId)
      ) {
        void persistToggleFollow(user.id, targetUserId, wasFollowing).catch(
          () => {
            setFollowingIds((prev) => {
              const next = new Set(prev);
              if (wasFollowing) next.add(targetUserId);
              else next.delete(targetUserId);
              return next;
            });
          },
        );
      }
    },
    [user, followingIds],
  );

  const blockUser = useCallback(
    async (targetUserId: string): Promise<BlockResult> => {
      if (!targetUserId || (user && targetUserId === user.id)) {
        return { ok: false, message: 'Impossible de vous bloquer vous-même.' };
      }
      if (!user) {
        setBlockedIds((prev) => new Set(prev).add(targetUserId));
        return { ok: true, mock: true, blocked: true };
      }

      const result = await persistBlockUser(user.id, targetUserId);
      if (result.ok) {
        setBlockedIds((prev) => new Set(prev).add(targetUserId));
        setFollowingIds((prev) => {
          if (!prev.has(targetUserId)) return prev;
          const next = new Set(prev);
          next.delete(targetUserId);
          return next;
        });
      }
      return result;
    },
    [user],
  );

  const bumpCommentCount = useCallback((videoId: string, delta = 1) => {
    setRawVideos((vids) =>
      vids.map((v) =>
        v.id === videoId
          ? { ...v, comments: Math.max(0, v.comments + delta) }
          : v,
      ),
    );
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
      followingIds,
      toggleFollow,
      blockedIds,
      blockUser,
      bumpCommentCount,
      isMockFeed: mockFeed,
      feedError,
    }),
    [
      videos,
      loading,
      refresh,
      publishPost,
      addLocalPost,
      toggleLike,
      likedIds,
      followingIds,
      toggleFollow,
      blockedIds,
      blockUser,
      bumpCommentCount,
      mockFeed,
      feedError,
    ],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeed(): FeedContextValue {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error('useFeed doit être utilisé dans FeedProvider');
  return ctx;
}

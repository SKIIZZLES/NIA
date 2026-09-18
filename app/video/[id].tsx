/**
 * Vertical player focused on a single video id (from profile grid tap).
 * Reuses VideoCard + CommentsSheet; resolves item from feed or Supabase.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoCard } from '@/components/VideoCard';
import { CommentsSheet } from '@/components/CommentsSheet';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  mapRowToVideoItem,
  VIDEO_PROFILE_SELECT,
} from '@/lib/videos';
import type { VideoItem } from '@/data/mockVideos';
import type { ProfileRow, VideoRow } from '@/types/database';

type VideoWithProfile = VideoRow & {
  profiles: Pick<ProfileRow, 'username' | 'avatar_url' | 'display_name'> | null;
};

export default function VideoPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const videoId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useI18n();
  const { videos, bumpCommentCount } = useFeed();
  const [remote, setRemote] = useState<VideoItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const fromFeed = useMemo(
    () => videos.find((v) => v.id === videoId) || null,
    [videos, videoId],
  );

  const item = fromFeed || remote;

  const loadRemote = useCallback(async () => {
    if (!videoId || fromFeed) return;
    if (!isSupabaseConfigured) {
      setError(t('feed.videoNotFound'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      if (!sb) {
        setError(t('feed.videoNotFound'));
        return;
      }
      const { data, error: qErr } = await sb
        .from('videos')
        .select(VIDEO_PROFILE_SELECT)
        .eq('id', videoId)
        .maybeSingle();
      if (qErr) throw qErr;
      if (!data) {
        setError(t('feed.videoNotFound'));
        setRemote(null);
        return;
      }
      const row = data as unknown as VideoWithProfile;
      const { data: urlData } = sb.storage
        .from('videos')
        .getPublicUrl(row.storage_path);
      setRemote(mapRowToVideoItem(row, urlData.publicUrl));
    } catch {
      setError(t('feed.videoNotFound'));
    } finally {
      setLoading(false);
    }
  }, [videoId, fromFeed, t]);

  useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  return (
    <View style={[styles.root, { height }]}>
      <Pressable
        style={[styles.back, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={26} color={Colors.sable} />
      </Pressable>

      {loading && !item ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.or} />
        </View>
      ) : error && !item ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : item ? (
        <VideoCard
          item={item}
          isActive
          bottomInset={0}
          onOpenComments={() => setCommentsOpen(true)}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.error}>{t('feed.videoNotFound')}</Text>
        </View>
      )}

      <CommentsSheet
        visible={commentsOpen}
        videoId={item?.id ?? null}
        onClose={() => setCommentsOpen(false)}
        onCommentAdded={(vid, delta) => bumpCommentCount(vid, delta)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.noir,
  },
  back: {
    position: 'absolute',
    left: 12,
    zIndex: 20,
    padding: 8,
    backgroundColor: 'rgba(11,11,11,0.45)',
    borderRadius: 20,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  error: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
    textAlign: 'center',
  },
});

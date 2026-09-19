import React, { memo } from 'react';
import {
  Image,
  ImageStyle,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, Fonts } from '@/constants/theme';
import { resolveGridThumbUrl } from '@/lib/mediaThumb';

type Props = {
  thumbnailUrl?: string | null;
  mediaType?: 'video' | 'image' | null;
  videoUrl?: string | null;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Show small "VIDEO" badge when media is video (with or without cover) */
  showVideoBadge?: boolean;
};

/**
 * 9:16 grid tile: Image from thumbnail when it's an image URL;
 * otherwise branded NIA placeholder (never loads .mp4 into Image).
 */
function MediaThumbInner({
  thumbnailUrl,
  mediaType,
  videoUrl,
  style,
  imageStyle,
  showVideoBadge = true,
}: Props) {
  const uri = resolveGridThumbUrl({ thumbnailUrl, mediaType, videoUrl });
  const isVideo = mediaType !== 'image';

  return (
    <View style={[styles.wrap, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={[styles.image, imageStyle]}
        />
      ) : (
        <View style={[styles.placeholder, imageStyle]}>
          <Text style={styles.logo}>NIA</Text>
          <Text style={styles.hint}>{isVideo ? 'Vidéo' : 'Média'}</Text>
        </View>
      )}
      {showVideoBadge && isVideo ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>▶</Text>
        </View>
      ) : null}
    </View>
  );
}

export const MediaThumb = memo(MediaThumbInner);

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.noirSoft,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.noirSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201, 162, 39, 0.35)',
  },
  logo: {
    color: Colors.or,
    fontFamily: Fonts.bold,
    fontSize: 18,
    letterSpacing: 2,
  },
  hint: {
    marginTop: 4,
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 10,
    opacity: 0.75,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(11,11,11,0.65)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: Colors.sable,
    fontSize: 10,
  },
});

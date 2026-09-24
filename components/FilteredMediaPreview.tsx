/**
 * Post-capture / create preview with NIA filter overlay wash.
 * Honest MVP: tint overlay approximates color-matrix / LUT — not real AR or GPU LUT.
 *
 * Image -> <Image>. Vidéo -> <VideoView> (expo-video), jamais <Image> :
 * un .mp4 passé à <Image> ne rend rien (cf. lib/mediaThumb.ts).
 * L'aperçu joue en boucle et en sourdine — pas de contrôles natifs.
 *
 * Le lecteur ne tourne que quand son écran a le focus. Le parcours de création
 * est une pile : pousser /create/preview laisse /create/index monté, et deux
 * décodages du même fichier tourneraient en parallèle. Ce composant n'est
 * rendu que dans cette pile, donc le contexte de navigation est toujours là.
 */
import React, { useEffect, useMemo } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  getFilterById,
  getFilterOverlayStyle,
  type FilterDefinition,
} from '@/constants/filters';
import { isLikelyVideoUrl } from '@/lib/mediaThumb';

type Props = {
  uri: string;
  /** Type connu par l'appelant. À défaut, déduit de l'extension de l'URI. */
  mediaType?: 'image' | 'video' | 'unknown' | null;
  filterId?: string | null;
  filter?: FilterDefinition | null;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function FilteredMediaPreview({
  uri,
  mediaType,
  filterId,
  filter: filterProp,
  intensity,
  style,
  imageStyle,
}: Props) {
  const isVideo =
    mediaType === 'video' ||
    ((mediaType == null || mediaType === 'unknown') && isLikelyVideoUrl(uri));

  // Hook inconditionnel (règle des hooks) : source null pour une image,
  // comme VideoCard le fait déjà pour les posts photo.
  const player = useVideoPlayer(isVideo ? uri : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  // expo-router réexporte useIsFocused depuis sa copie de React Navigation
  // (@react-navigation/native n'est pas une dépendance du projet).
  const isFocused = useIsFocused();

  // Suspendre, pas détruire : le même lecteur reprend là où il s'est arrêté
  // quand l'écran revient au premier plan. Le brouillon n'est pas touché.
  useEffect(() => {
    if (!isVideo) return;
    try {
      if (isFocused) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // aperçu non lisible : la première frame reste affichée
    }
  }, [isVideo, isFocused, player]);

  const filter = filterProp ?? getFilterById(filterId ?? null);
  const overlay = useMemo(
    () => getFilterOverlayStyle(filter, intensity),
    [filter, intensity],
  );

  return (
    <View style={[styles.wrap, style]}>
      {isVideo ? (
        <VideoView
          player={player}
          style={styles.media}
          contentFit="cover"
          nativeControls={false}
        />
      ) : (
        <Image
          source={{ uri }}
          style={[styles.media, imageStyle]}
          resizeMode="cover"
        />
      )}
      {overlay ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: overlay.backgroundColor,
              opacity: overlay.opacity,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
  media: {
    width: '100%',
    height: '100%',
  },
});

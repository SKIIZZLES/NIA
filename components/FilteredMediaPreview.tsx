/**
 * Post-capture / create preview with NIA filter overlay wash.
 * Honest MVP: tint overlay approximates color-matrix / LUT — not real AR or GPU LUT.
 *
 * Image -> <Image>. Vidéo -> <VideoView> (expo-video), jamais <Image> :
 * un .mp4 passé à <Image> ne rend rien (cf. lib/mediaThumb.ts).
 * L'aperçu joue en boucle, en sourdine par défaut — pas de contrôles natifs.
 * Sprint S2 : `muted={false}` + `volume` règlent le son original, et `sound`
 * joue le son choisi en synchro avec la vidéo (ou en boucle sur une photo).
 *
 * Le lecteur ne tourne que quand son écran a le focus. Le parcours de création
 * est une pile : pousser /create/preview laisse /create/index monté, et deux
 * décodages du même fichier tourneraient en parallèle. Ce composant n'est
 * rendu que dans cette pile, donc le contexte de navigation est toujours là.
 *
 * `tapToPause` : toucher la vidéo la met en pause / la relance, avec une
 * icône lecture sur voile sombre (`mediaScrim`) tant qu'elle est en pause.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import {
  getFilterById,
  getFilterOverlayStyle,
  type FilterDefinition,
} from '@/constants/filters';
import { isLikelyVideoUrl } from '@/lib/mediaThumb';
import { SyncedSound } from '@/components/SyncedSound';
import { OverlayLayer } from '@/components/OverlayLayer';
import type { OverlayDoc } from '@/lib/overlays';

type Props = {
  uri: string;
  /** Type connu par l'appelant. À défaut, déduit de l'extension de l'URI. */
  mediaType?: 'image' | 'video' | 'unknown' | null;
  filterId?: string | null;
  filter?: FilterDefinition | null;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Son original de la vidéo coupé (défaut : true, comme avant S2). */
  muted?: boolean;
  /** Volume du son original, 0 → 1. */
  volume?: number;
  /** Son ajouté, joué en synchro. */
  sound?: { url: string; offsetMs?: number; volume?: number } | null;
  /** Vitesse de lecture choisie à l'édition (S3), 1 par défaut. */
  playbackRate?: number;
  /** Calques texte / stickers du brouillon (S4), au-dessus du filtre. */
  overlays?: OverlayDoc | null;
  /** Toucher la vidéo : pause / lecture, icône lecture en pause. */
  tapToPause?: boolean;
};

export function FilteredMediaPreview({
  uri,
  mediaType,
  filterId,
  filter: filterProp,
  intensity,
  style,
  imageStyle,
  muted = true,
  volume = 1,
  sound = null,
  playbackRate = 1,
  overlays = null,
  tapToPause = false,
}: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const [userPaused, setUserPaused] = useState(false);
  const isVideo =
    mediaType === 'video' ||
    ((mediaType == null || mediaType === 'unknown') && isLikelyVideoUrl(uri));

  // Hook inconditionnel (règle des hooks) : source null pour une image,
  // comme VideoCard le fait déjà pour les posts photo.
  const player = useVideoPlayer(isVideo ? uri : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });

  // expo-router réexporte useIsFocused depuis sa copie de React Navigation
  // (@react-navigation/native n'est pas une dépendance du projet).
  const isFocused = useIsFocused();
  // Quitter l'écran met en pause ; la pause voulue par l'utilisateur tient
  // jusqu'à ce qu'il retouche la vidéo.
  const playing = isFocused && !(tapToPause && userPaused);

  // Suspendre, pas détruire : le même lecteur reprend là où il s'est arrêté
  // quand l'écran revient au premier plan. Le brouillon n'est pas touché.
  useEffect(() => {
    if (!isVideo) return;
    try {
      if (playing) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // aperçu non lisible : la première frame reste affichée
    }
  }, [isVideo, playing, player]);

  useEffect(() => {
    if (!isVideo) return;
    try {
      player.muted = muted || volume <= 0;
      player.volume = Math.max(0, Math.min(1, volume));
      player.preservesPitch = true;
      player.playbackRate = playbackRate > 0 ? playbackRate : 1;
    } catch {
      // lecteur libéré
    }
  }, [isVideo, player, muted, volume, playbackRate]);

  const filter = filterProp ?? getFilterById(filterId ?? null);
  const overlay = useMemo(
    () => getFilterOverlayStyle(filter, intensity),
    [filter, intensity],
  );

  return (
    <View style={[styles.wrap, style]}>
      {sound?.url ? (
        <SyncedSound
          url={sound.url}
          video={isVideo ? player : null}
          active={isVideo ? playing : isFocused}
          offsetMs={sound.offsetMs ?? 0}
          volume={sound.volume ?? 1}
          rate={isVideo ? playbackRate : 1}
        />
      ) : null}
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
      <OverlayLayer doc={overlays} player={isVideo ? player : null} timeMs={isVideo ? undefined : null} />
      {isVideo && tapToPause ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setUserPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={userPaused ? t('feed.play') : t('feed.pause')}
        >
          {userPaused ? (
            <View style={styles.playBadge} pointerEvents="none">
              <View style={[styles.playCircle, { backgroundColor: colors.mediaScrim }]}>
                <Ionicons name="play" size={30} color={colors.onMedia} style={{ marginLeft: 3 }} />
              </View>
            </View>
          ) : null}
        </Pressable>
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
  playBadge: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

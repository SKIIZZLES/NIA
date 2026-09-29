/**
 * Choix de la couverture parmi des images de la vidéo (sprint S3).
 *
 * Les images sont extraites en fichiers JPEG (react-native-media-toolkit) :
 * affichables par <Image> et envoyables telles quelles comme couverture.
 * (generateThumbnailsAsync d'expo-video ne produit pas de fichier et demande
 * expo-image pour l'affichage.) La galerie reste proposée à côté.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Radii, Spacing } from '@/constants/theme';
import { formatSoundTime } from '@/lib/soundSync';
import { frameTimes, videoFrameAt } from '@/lib/videoTrim';

const COUNT = 8;

type Props = {
  uri: string;
  durationMs: number | null;
  selectedUri: string | null;
  onPick: (uri: string) => void;
};

export function CoverFramePicker({ uri, durationMs, selectedUri, onPick }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const [frames, setFrames] = useState<{ time: number; uri: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uri || !durationMs || durationMs <= 0) return;
    let alive = true;
    setFrames([]);
    setLoading(true);
    void (async () => {
      for (const time of frameTimes(durationMs, COUNT)) {
        // 480 px : assez net pour une couverture, léger à envoyer.
        const f = await videoFrameAt(uri, time, 480);
        if (!alive) return;
        if (f) setFrames((prev) => [...prev, { time, uri: f }]);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [uri, durationMs]);

  if (!durationMs) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={{ marginTop: Spacing.sm }}
    >
      {frames.map((f) => {
        const on = selectedUri === f.uri;
        return (
          <Pressable
            key={f.uri}
            onPress={() => onPick(f.uri)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t('create.coverFrameA11y', { time: formatSoundTime(f.time) })}
            style={[styles.item, { borderColor: on ? colors.or : colors.border }]}
          >
            <Image source={{ uri: f.uri }} style={styles.img} resizeMode="cover" />
          </Pressable>
        );
      })}
      {loading ? (
        <View style={[styles.item, styles.center, { borderColor: colors.border }]}>
          <ActivityIndicator color={colors.or} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  item: {
    width: 60,
    height: 96,
    borderRadius: Radii.sm,
    borderWidth: 2,
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
});

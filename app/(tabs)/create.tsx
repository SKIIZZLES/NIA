import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useFeed } from '@/context/FeedContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import {
  DISCOVER_CATEGORIES,
  type CategoryId,
} from '@/constants/categories';
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SEC,
  PUBLISH_ERRORS,
  parseHashtags,
} from '@/constants/publish';

type PickedMedia = {
  uri: string;
  mimeType: string | null;
  fileSize: number | null;
  durationMs: number | null;
  type: 'image' | 'video' | 'unknown';
};

export default function CreateScreen() {
  const { publishPost, isMockFeed } = useFeed();
  const router = useRouter();
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [busy, setBusy] = useState(false);

  const hashtags = useMemo(() => parseHashtags(caption), [caption]);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });
    if (res.canceled || !res.assets[0]) return;

    const asset = res.assets[0];
    const fileSize = asset.fileSize ?? null;
    const durationMs =
      typeof asset.duration === 'number' ? asset.duration : null;
    const type: PickedMedia['type'] =
      asset.type === 'video'
        ? 'video'
        : asset.type === 'image'
          ? 'image'
          : asset.mimeType?.startsWith('video')
            ? 'video'
            : asset.mimeType?.startsWith('image')
              ? 'image'
              : 'unknown';

    if (fileSize != null && fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert('Fichier trop volumineux', PUBLISH_ERRORS.tooLarge);
      return;
    }
    if (
      type === 'video' &&
      durationMs != null &&
      durationMs > MAX_VIDEO_DURATION_SEC * 1000
    ) {
      Alert.alert('Vidéo trop longue', PUBLISH_ERRORS.tooLong);
      return;
    }

    setMedia({
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      fileSize,
      durationMs,
      type,
    });
  };

  const publish = async () => {
    if (!media?.uri && !isMockFeed) {
      Alert.alert('Média requis', PUBLISH_ERRORS.noMedia);
      return;
    }
    if (!category) {
      Alert.alert('Catégorie', PUBLISH_ERRORS.categoryRequired);
      return;
    }
    if (media?.fileSize != null && media.fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert('Fichier trop volumineux', PUBLISH_ERRORS.tooLarge);
      return;
    }
    if (
      media?.type === 'video' &&
      media.durationMs != null &&
      media.durationMs > MAX_VIDEO_DURATION_SEC * 1000
    ) {
      Alert.alert('Vidéo trop longue', PUBLISH_ERRORS.tooLong);
      return;
    }

    setBusy(true);
    try {
      await publishPost({
        caption,
        localUri: media?.uri || undefined,
        mimeType: media?.mimeType ?? null,
        category,
        hashtags,
        fileSize: media?.fileSize ?? undefined,
        durationMs: media?.durationMs ?? undefined,
      });
      setCaption('');
      setMedia(null);
      setCategory(null);
      Alert.alert(
        isMockFeed ? 'Publié (mock)' : 'Publié',
        isMockFeed
          ? 'Ajouté au fil local « Pour toi ».'
          : 'Vidéo envoyée sur Supabase Storage + table videos (statut published).',
      );
      router.push('/(tabs)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Échec de la publication';
      Alert.alert('Erreur', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Créer</Text>
        <Text style={styles.subtitle}>
          {isMockFeed
            ? 'Mode mock — média, légende, #hashtags et catégorie. Publication dans le feed local.'
            : 'Mode Supabase — upload Storage + ligne videos (statut published).'}
        </Text>

        <View style={styles.preview}>
          {media?.uri ? (
            <>
              <Image source={{ uri: media.uri }} style={styles.thumb} />
              <View style={styles.previewBadge}>
                <Text style={styles.previewBadgeText}>
                  {media.type === 'video' ? 'Vidéo' : 'Image'}
                  {media.durationMs != null
                    ? ` · ${Math.round(media.durationMs / 1000)} s`
                    : ''}
                  {media.fileSize != null
                    ? ` · ${(media.fileSize / (1024 * 1024)).toFixed(1)} Mo`
                    : ''}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.previewHint}>Aucun média sélectionné</Text>
          )}
        </View>

        <Button
          title="Choisir un média (galerie)"
          variant="outline"
          onPress={pick}
        />

        <Text style={styles.label}>Légende & hashtags</Text>
        <TextInput
          style={styles.input}
          multiline
          value={caption}
          onChangeText={setCaption}
          placeholder="Décrivez votre talent… Ajoutez #afrique #culture"
          placeholderTextColor={Colors.textMuted}
        />
        {hashtags.length > 0 ? (
          <View style={styles.tagRow}>
            {hashtags.map((t) => (
              <View key={t} style={styles.tagChip}>
                <Text style={styles.tagText}>#{t}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>
            Les #mots dans la légende deviennent des hashtags à la publication.
          </Text>
        )}

        <Text style={styles.label}>Catégorie</Text>
        <View style={styles.catRow}>
          {DISCOVER_CATEGORIES.map((c) => {
            const selected = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.catChip, selected && styles.catChipOn]}
              >
                <Text style={[styles.catText, selected && styles.catTextOn]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Max {MAX_VIDEO_DURATION_SEC} s ·{' '}
          {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo
        </Text>

        <Button
          title="Publier"
          variant="gold"
          loading={busy}
          onPress={publish}
          style={{ marginTop: Spacing.md, marginBottom: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.noir,
  },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 8,
    marginBottom: Spacing.lg,
    lineHeight: 18,
  },
  preview: {
    height: 220,
    borderRadius: Radii.lg,
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  previewHint: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
  },
  previewBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  previewBadgeText: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 11,
  },
  label: {
    marginTop: Spacing.lg,
    marginBottom: 6,
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  input: {
    minHeight: 100,
    textAlignVertical: 'top',
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 15,
    padding: 14,
  },
  hint: {
    marginTop: 8,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tagChip: {
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.or,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    color: Colors.or,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  catRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.noirSoft,
  },
  catChipOn: {
    borderColor: Colors.or,
    backgroundColor: 'rgba(201, 162, 39, 0.18)',
  },
  catText: {
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  catTextOn: {
    color: Colors.or,
  },
});

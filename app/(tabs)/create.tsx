import React, { useState } from 'react';
import {
  Alert,
  Image,
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

export default function CreateScreen() {
  const { publishPost, isMockFeed } = useFeed();
  const router = useRouter();
  const [caption, setCaption] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      quality: 0.8,
    });
    if (!res.canceled && res.assets[0]) {
      setUri(res.assets[0].uri);
      setMimeType(res.assets[0].mimeType ?? null);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await publishPost({
        caption,
        localUri: uri || undefined,
        mimeType,
      });
      setCaption('');
      setUri(null);
      setMimeType(null);
      Alert.alert(
        isMockFeed ? 'Publié (mock)' : 'Publié',
        isMockFeed
          ? 'Ajouté au fil local « Pour toi ».'
          : 'Vidéo envoyée sur Supabase Storage + table videos.',
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
      <Text style={styles.title}>Créer</Text>
      <Text style={styles.subtitle}>
        {isMockFeed
          ? 'Mode mock — sélection média + légende. Publication dans le feed local (pas d’upload CDN).'
          : 'Mode Supabase — le média est uploadé dans le bucket « videos », puis une ligne est créée.'}
      </Text>

      <View style={styles.preview}>
        {uri ? (
          <Image source={{ uri }} style={styles.thumb} />
        ) : (
          <Text style={styles.previewHint}>Aucun média sélectionné</Text>
        )}
      </View>

      <Button title="Choisir / enregistrer (galerie)" variant="outline" onPress={pick} />

      <Text style={styles.label}>Légende</Text>
      <TextInput
        style={styles.input}
        multiline
        value={caption}
        onChangeText={setCaption}
        placeholder="Décrivez votre talent, culture, moment…"
        placeholderTextColor={Colors.textMuted}
      />

      <Button
        title="Publier"
        variant="gold"
        loading={busy}
        onPress={publish}
        style={{ marginTop: Spacing.md }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.noir,
    paddingHorizontal: Spacing.lg,
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
    height: 200,
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
});

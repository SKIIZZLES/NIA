/**
 * Créer une série — titre, description, cover optionnelle.
 */
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
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { createSeries, isSupabaseConfigured } from '@/lib/series';

type CoverPick = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
};

export default function CreateSeriesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<CoverPick | null>(null);
  const [busy, setBusy] = useState(false);

  const pickCover = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setCover({
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      fileName: asset.fileName ?? null,
    });
  };

  const onSubmit = async () => {
    if (!user?.id) {
      Alert.alert(t('series.loginRequiredTitle'), t('series.loginRequiredCreate'));
      return;
    }
    if (!isSupabaseConfigured) {
      Alert.alert(t('common.error'), t('series.mockHint'));
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('series.titleRequired'));
      return;
    }
    setBusy(true);
    try {
      const created = await createSeries({
        userId: user.id,
        title: trimmed,
        description: description.trim() || null,
        coverLocalUri: cover?.uri ?? null,
        coverMimeType: cover?.mimeType ?? null,
        coverFileName: cover?.fileName ?? null,
      });
      Alert.alert(t('series.publishSuccess'), undefined, [
        {
          text: 'OK',
          onPress: () => router.replace(`/series/${created.id}`),
        },
      ]);
    } catch (e) {
      Alert.alert(
        t('series.publishFail'),
        e instanceof Error ? e.message : t('series.publishFail'),
      );
    } finally {
      setBusy(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          gap: Spacing.sm,
        },
        backBtn: { padding: 6 },
        topTitle: {
          flex: 1,
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 18,
        },
        scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
        label: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 13,
          marginTop: Spacing.md,
          marginBottom: 6,
        },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: Radii.md,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 15,
          backgroundColor: colors.noirElevated,
        },
        area: { minHeight: 90, textAlignVertical: 'top' },
        coverBox: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          overflow: 'hidden',
          minHeight: 160,
          alignItems: 'center',
          justifyContent: 'center',
        },
        coverImg: { width: '100%', height: 180 },
        coverHint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          marginTop: 6,
        },
        coverCta: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 14,
          marginTop: 8,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('series.createTitle')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{t('series.fieldTitle')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('series.fieldTitlePlaceholder')}
          placeholderTextColor={colors.textMuted}
          maxLength={120}
        />

        <Text style={styles.label}>{t('series.fieldDescription')}</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={description}
          onChangeText={setDescription}
          placeholder={t('series.fieldDescriptionPlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
        />

        <Text style={styles.label}>{t('series.fieldCover')}</Text>
        <Pressable style={styles.coverBox} onPress={() => void pickCover()}>
          {cover ? (
            <Image source={{ uri: cover.uri }} style={styles.coverImg} />
          ) : (
            <>
              <Ionicons name="image-outline" size={36} color={colors.or} />
              <Text style={styles.coverCta}>{t('series.pickCover')}</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.coverHint}>{t('series.coverHint')}</Text>
        {cover ? (
          <Pressable onPress={() => void pickCover()}>
            <Text style={styles.coverCta}>{t('series.changeCover')}</Text>
          </Pressable>
        ) : null}

        <Button
          title={busy ? t('common.loading') : t('series.publish')}
          variant="gold"
          onPress={() => void onSubmit()}
          disabled={busy}
          style={{ marginTop: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

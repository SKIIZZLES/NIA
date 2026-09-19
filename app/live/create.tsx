/**
 * Programmer un live — métadonnées seulement (status = scheduled).
 * Aucun provider stream / URL de lecture.
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
import {
  LIVE_CATEGORIES,
  LIVE_VISIBILITIES,
  type LiveCategoryId,
  type LiveVisibility,
} from '@/constants/liveCategories';
import { createScheduledStream, isSupabaseConfigured } from '@/lib/live';

type ThumbPick = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultDateParts(d = new Date()): { date: string; time: string } {
  const inOneHour = new Date(d.getTime() + 60 * 60 * 1000);
  return {
    date: `${inOneHour.getFullYear()}-${pad2(inOneHour.getMonth() + 1)}-${pad2(inOneHour.getDate())}`,
    time: `${pad2(inOneHour.getHours())}:${pad2(inOneHour.getMinutes())}`,
  };
}

function combineLocalIso(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]) - 1;
  const day = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(day) ||
    !Number.isFinite(h) ||
    !Number.isFinite(mi) ||
    h < 0 ||
    h > 23 ||
    mi < 0 ||
    mi > 59
  ) {
    return null;
  }
  const local = new Date(y, mo, day, h, mi, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export default function CreateLiveScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const defaults = defaultDateParts();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [category, setCategory] = useState<LiveCategoryId | null>(null);
  const [visibility, setVisibility] = useState<LiveVisibility>('public');
  const [thumb, setThumb] = useState<ThumbPick | null>(null);
  const [busy, setBusy] = useState(false);

  const pickThumb = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setThumb({
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      fileName: asset.fileName ?? null,
    });
  };

  const publish = async () => {
    if (!user?.id) {
      Alert.alert(t('live.loginRequiredTitle'), t('live.loginRequiredCreate'));
      return;
    }
    if (!isSupabaseConfigured || user.id.startsWith('mock_')) {
      Alert.alert(t('common.error'), t('live.mockHint'));
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('live.titleRequired'));
      return;
    }
    if (!category) {
      Alert.alert(t('common.error'), t('live.categoryRequired'));
      return;
    }
    const scheduledAt = combineLocalIso(date, time);
    if (!scheduledAt) {
      Alert.alert(t('common.error'), t('live.dateRequired'));
      return;
    }

    setBusy(true);
    try {
      const created = await createScheduledStream({
        userId: user.id,
        title: trimmed,
        description: description.trim() || null,
        category,
        visibility,
        scheduledAt,
        thumbnailLocalUri: thumb?.uri ?? null,
        thumbnailMimeType: thumb?.mimeType ?? null,
        thumbnailFileName: thumb?.fileName ?? null,
      });
      Alert.alert(t('live.publishSuccess'), t('live.publishSuccessBody'), [
        {
          text: 'OK',
          onPress: () => router.replace(`/live/${created.id}`),
        },
      ]);
    } catch (e) {
      Alert.alert(
        t('common.error'),
        e instanceof Error ? e.message : t('live.publishFail'),
      );
    } finally {
      setBusy(false);
    }
  };

  const visibilityLabel = (v: LiveVisibility) => {
    if (v === 'public') return t('live.visPublic');
    if (v === 'followers') return t('live.visFollowers');
    return t('live.visPrivate');
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
          gap: 8,
        },
        backBtn: {
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
        },
        topTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 17,
          flex: 1,
        },
        scroll: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
        },
        notice: {
          marginTop: Spacing.sm,
          padding: Spacing.md,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirElevated,
          marginBottom: Spacing.sm,
        },
        noticeTitle: {
          color: colors.or,
          fontFamily: Fonts.bold,
          fontSize: 13,
          marginBottom: 4,
        },
        noticeBody: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
        },
        label: {
          marginTop: Spacing.md,
          marginBottom: 6,
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        input: {
          backgroundColor: colors.noirSoft,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: Radii.md,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 15,
          paddingHorizontal: 14,
          paddingVertical: 12,
        },
        inputArea: {
          minHeight: 100,
          textAlignVertical: 'top',
        },
        hint: {
          marginTop: 6,
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
        },
        row: { flexDirection: 'row', gap: Spacing.sm },
        flex: { flex: 1 },
        coverBox: {
          height: 160,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirSoft,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          marginTop: Spacing.sm,
        },
        coverImg: { width: '100%', height: '100%' },
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
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
        },
        catChipOn: {
          borderColor: colors.or,
          backgroundColor: 'rgba(201, 162, 39, 0.18)',
        },
        catText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        catTextOn: { color: colors.or },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('live.createTitle')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{t('live.soonBanner')}</Text>
          <Text style={styles.noticeBody}>{t('live.createNotice')}</Text>
        </View>

        <Text style={styles.label}>{t('live.fieldTitle')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('live.fieldTitlePlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('live.fieldDescription')}</Text>
        <TextInput
          style={[styles.input, styles.inputArea]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder={t('live.fieldDescriptionPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('live.fieldThumbnail')}</Text>
        <View style={styles.coverBox}>
          {thumb?.uri ? (
            <Image source={{ uri: thumb.uri }} style={styles.coverImg} />
          ) : (
            <Text style={styles.hint}>{t('live.thumbnailHint')}</Text>
          )}
        </View>
        <Button
          title={thumb ? t('live.changeThumbnail') : t('live.pickThumbnail')}
          variant="outline"
          onPress={() => void pickThumb()}
          style={{ marginTop: Spacing.sm }}
        />

        <Text style={styles.label}>{t('live.fieldScheduled')}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, styles.flex]}
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        </View>
        <Text style={styles.hint}>{t('live.dateHint')}</Text>

        <Text style={styles.label}>{t('live.fieldVisibility')}</Text>
        <View style={styles.catRow}>
          {LIVE_VISIBILITIES.map((v) => {
            const on = visibility === v;
            return (
              <Pressable
                key={v}
                onPress={() => setVisibility(v)}
                style={[styles.catChip, on && styles.catChipOn]}
              >
                <Text style={[styles.catText, on && styles.catTextOn]}>
                  {visibilityLabel(v)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>{t('live.fieldCategory')}</Text>
        <View style={styles.catRow}>
          {LIVE_CATEGORIES.map((c) => {
            const on = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.catChip, on && styles.catChipOn]}
              >
                <Text style={[styles.catText, on && styles.catTextOn]}>
                  {t(c.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Button
          title={t('live.publish')}
          variant="gold"
          loading={busy}
          onPress={() => void publish()}
          style={{ marginTop: Spacing.lg, marginBottom: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

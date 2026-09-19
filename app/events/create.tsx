/**
 * Créer un événement — titre, description, cover, date/heure, lieu, catégorie.
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
  EVENT_CATEGORIES,
  type EventCategoryId,
} from '@/constants/eventCategories';
import { createEvent, isSupabaseConfigured } from '@/lib/events';

type CoverPick = {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultDateParts(d = new Date()): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
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

export default function CreateEventScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const defaults = defaultDateParts();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState<EventCategoryId | null>(null);
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

  const publish = async () => {
    if (!user?.id) {
      Alert.alert(t('events.loginRequiredTitle'), t('events.loginRequired'));
      return;
    }
    if (!isSupabaseConfigured || user.id.startsWith('mock_')) {
      Alert.alert(t('common.error'), t('events.mockHint'));
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('events.titleRequired'));
      return;
    }
    if (!category) {
      Alert.alert(t('common.error'), t('events.categoryRequired'));
      return;
    }
    const startsAt = combineLocalIso(date, time);
    if (!startsAt) {
      Alert.alert(t('common.error'), t('events.dateRequired'));
      return;
    }
    let endsAt: string | null = null;
    if (endDate.trim() && endTime.trim()) {
      endsAt = combineLocalIso(endDate, endTime);
      if (!endsAt) {
        Alert.alert(t('common.error'), t('events.endDateInvalid'));
        return;
      }
    }

    setBusy(true);
    try {
      const created = await createEvent({
        userId: user.id,
        title: trimmed,
        description: description.trim() || null,
        locationText: locationText.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        startsAt,
        endsAt,
        category,
        coverLocalUri: cover?.uri ?? null,
        coverMimeType: cover?.mimeType ?? null,
        coverFileName: cover?.fileName ?? null,
      });
      Alert.alert(t('events.publishSuccess'), undefined, [
        {
          text: 'OK',
          onPress: () => router.replace(`/events/${created.id}`),
        },
      ]);
    } catch (e) {
      Alert.alert(
        t('common.error'),
        e instanceof Error ? e.message : t('events.publishFail'),
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
        <Text style={styles.topTitle}>{t('events.createTitle')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.label}>{t('events.fieldTitle')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('events.fieldTitlePlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('events.fieldDescription')}</Text>
        <TextInput
          style={[styles.input, styles.inputArea]}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder={t('events.fieldDescriptionPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('events.fieldCover')}</Text>
        <View style={styles.coverBox}>
          {cover?.uri ? (
            <Image source={{ uri: cover.uri }} style={styles.coverImg} />
          ) : (
            <Text style={styles.hint}>{t('events.coverHint')}</Text>
          )}
        </View>
        <Button
          title={cover ? t('events.changeCover') : t('events.pickCover')}
          variant="outline"
          onPress={() => void pickCover()}
          style={{ marginTop: Spacing.sm }}
        />

        <Text style={styles.label}>{t('events.fieldStartsDate')}</Text>
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
        <Text style={styles.hint}>{t('events.dateHint')}</Text>

        <Text style={styles.label}>{t('events.fieldEndsDate')}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.input, styles.flex]}
            value={endTime}
            onChangeText={setEndTime}
            placeholder="HH:MM"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        </View>

        <Text style={styles.label}>{t('events.fieldLocation')}</Text>
        <TextInput
          style={styles.input}
          value={locationText}
          onChangeText={setLocationText}
          placeholder={t('events.fieldLocationPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('events.fieldCity')}</Text>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          placeholder={t('events.fieldCityPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('events.fieldCountry')}</Text>
        <TextInput
          style={styles.input}
          value={country}
          onChangeText={setCountry}
          placeholder={t('events.fieldCountryPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>{t('events.fieldCategory')}</Text>
        <View style={styles.catRow}>
          {EVENT_CATEGORIES.map((c) => {
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
          title={t('events.publish')}
          variant="gold"
          loading={busy}
          onPress={() => void publish()}
          style={{ marginTop: Spacing.lg, marginBottom: Spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

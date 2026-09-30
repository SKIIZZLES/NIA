import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { BirthDateInput, EMPTY_BIRTH_DATE } from '@/components/BirthDateInput';
import { CONTACT_EMAIL } from '@/constants/legal';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useAge } from '@/context/AgeContext';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import {
  birthDateCheckErrorKey,
  checkBirthDate,
  formatBirthDate,
  isOldEnoughToSignUp,
  markAgeRefused,
  type BirthDateParts,
} from '@/lib/age';

/** « Âge et contenus 18+ » : date de naissance privée et choix d'affichage (migration 020). */
export default function ContentSettingsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const colors = useColors();
  const { user } = useAuth();
  const { status, loading, declare, setShowMature } = useAge();
  const { refresh: refreshFeed } = useFeed();
  const [parts, setParts] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [busy, setBusy] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        topBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
        },
        backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
        topTitle: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 17 },
        content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
        intro: { color: colors.textSecondary, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
        card: {
          padding: 14,
          borderRadius: Radii.md,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          gap: 10,
        },
        row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
        rowText: { flex: 1, gap: 2 },
        label: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 15 },
        hint: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
        body: { color: colors.textSecondary, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19 },
      }),
    [colors],
  );

  const onDeclare = () => {
    const check = checkBirthDate(parts);
    if (!check.ok) {
      Alert.alert(t('common.error'), t(birthDateCheckErrorKey(check.reason)));
      return;
    }
    if (!isOldEnoughToSignUp(check.age, status.minAge)) {
      void markAgeRefused();
      Alert.alert(t('age.tooYoungTitle'), t('age.tooYoungBody', { age: status.minAge }));
      return;
    }
    Alert.alert(t('age.confirmTitle'), t('age.confirmBody', { date: formatBirthDate(check.iso) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('age.confirm'),
        onPress: () => {
          void (async () => {
            setBusy(true);
            const r = await declare(check.iso);
            setBusy(false);
            if (!r.ok) {
              Alert.alert(t('common.error'), t(r.errorKey, { email: CONTACT_EMAIL, age: status.minAge }));
            }
          })();
        },
      },
    ]);
  };

  const onToggle = (on: boolean) => {
    void (async () => {
      setBusy(true);
      const r = await setShowMature(on);
      setBusy(false);
      if (!r.ok) {
        Alert.alert(t('common.error'), t(r.errorKey));
        return;
      }
      void refreshFeed();
    })();
  };

  let body: React.ReactNode;
  if (!user) {
    body = <Text style={styles.body}>{t('age.signInRequired')}</Text>;
  } else if (loading) {
    body = <ActivityIndicator color={colors.or} />;
  } else if (!status.supported) {
    body = <Text style={styles.body}>{t('age.unavailable')}</Text>;
  } else if (!status.declared) {
    body = (
      <View style={styles.card}>
        <Text style={styles.body}>{t('age.statusMissing')}</Text>
        <BirthDateInput value={parts} onChange={setParts} editable={!busy} />
        <Text style={styles.hint}>{t('age.birthDateHint')}</Text>
        <Button title={t('age.declareCta')} loading={busy} onPress={onDeclare} />
      </View>
    );
  } else {
    body = (
      <>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="calendar-outline" size={20} color={colors.or} />
            <Text style={[styles.body, { flex: 1 }]}>{t('age.statusDeclared')}</Text>
          </View>
          <Text style={styles.hint}>{t('age.correction', { email: CONTACT_EMAIL })}</Text>
        </View>
        <View style={styles.card}>
          {status.adult ? (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>{t('age.showMature')}</Text>
                <Text style={styles.hint}>{t('age.showMatureHint')}</Text>
              </View>
              <Switch
                value={status.showMature}
                onValueChange={onToggle}
                disabled={busy}
                trackColor={{ false: colors.noirSoft, true: colors.or }}
                thumbColor={colors.sable}
                accessibilityLabel={t('age.showMature')}
              />
            </View>
          ) : (
            <Text style={styles.body}>{t('age.minorInfo')}</Text>
          )}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>{t('age.settingsTitle')}</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('age.settingsIntro')}</Text>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

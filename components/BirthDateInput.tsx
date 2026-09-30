/**
 * Saisie de la date de naissance en trois champs (JJ / MM / AAAA), sans
 * dépendance native (pas de sélecteur de date installé). La validation est
 * dans lib/age.ts (checkBirthDate) ; le serveur (020) revérifie.
 */
import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import type { BirthDateParts } from '@/lib/age';

type Props = {
  value: BirthDateParts;
  onChange: (next: BirthDateParts) => void;
  editable?: boolean;
  /** Libellé au-dessus des champs (masqué si false). */
  showLabel?: boolean;
};

export const EMPTY_BIRTH_DATE: BirthDateParts = { day: '', month: '', year: '' };

const digits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max);

export function BirthDateInput({ value, onChange, editable = true, showLabel = true }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const monthRef = useRef<TextInput | null>(null);
  const yearRef = useRef<TextInput | null>(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        label: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 13, marginBottom: 6 },
        row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
        input: {
          backgroundColor: colors.noirSoft,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: Radii.md,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 16,
          paddingHorizontal: 12,
          paddingVertical: 14,
          textAlign: 'center',
        },
        short: { flex: 2 },
        long: { flex: 3 },
        sep: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 16 },
      }),
    [colors],
  );

  return (
    <View>
      {showLabel ? <Text style={styles.label}>{t('age.birthDateLabel')}</Text> : null}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.short]}
          value={value.day}
          onChangeText={(s) => {
            const day = digits(s, 2);
            onChange({ ...value, day });
            if (day.length === 2) monthRef.current?.focus();
          }}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={t('age.day')}
          placeholderTextColor={colors.textMuted}
          editable={editable}
          accessibilityLabel={t('age.dayA11y')}
          textContentType="none"
          autoComplete="birthdate-day"
        />
        <Text style={styles.sep}>/</Text>
        <TextInput
          ref={monthRef}
          style={[styles.input, styles.short]}
          value={value.month}
          onChangeText={(s) => {
            const month = digits(s, 2);
            onChange({ ...value, month });
            if (month.length === 2) yearRef.current?.focus();
          }}
          keyboardType="number-pad"
          maxLength={2}
          placeholder={t('age.month')}
          placeholderTextColor={colors.textMuted}
          editable={editable}
          accessibilityLabel={t('age.monthA11y')}
          autoComplete="birthdate-month"
        />
        <Text style={styles.sep}>/</Text>
        <TextInput
          ref={yearRef}
          style={[styles.input, styles.long]}
          value={value.year}
          onChangeText={(s) => onChange({ ...value, year: digits(s, 4) })}
          keyboardType="number-pad"
          maxLength={4}
          placeholder={t('age.year')}
          placeholderTextColor={colors.textMuted}
          editable={editable}
          accessibilityLabel={t('age.yearA11y')}
          autoComplete="birthdate-year"
        />
      </View>
    </View>
  );
}

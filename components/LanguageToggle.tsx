import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { APP_LOCALES, type AppLocale } from '@/lib/i18n';

type Props = {
  /** Compact row for welcome; fuller for profile. */
  compact?: boolean;
  style?: object;
};

export function LanguageToggle({ compact, style }: Props) {
  const { locale, setLocale, t } = useI18n();

  const pick = (next: AppLocale) => {
    if (next !== locale) void setLocale(next);
  };

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]}>
      {!compact ? (
        <Text style={styles.label}>{t('language.label')}</Text>
      ) : null}
      <View style={styles.row}>
        {APP_LOCALES.map((code) => {
          const on = locale === code;
          return (
            <Pressable
              key={code}
              onPress={() => pick(code)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(`language.${code}`)}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {t(`language.${code}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  wrapCompact: {
    marginTop: Spacing.sm,
  },
  label: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  chip: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.noirSoft,
    alignItems: 'center',
  },
  chipOn: {
    borderColor: Colors.or,
    backgroundColor: 'rgba(201, 162, 39, 0.18)',
  },
  chipText: {
    color: Colors.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  chipTextOn: {
    color: Colors.or,
  },
});

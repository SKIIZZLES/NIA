import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { CONTACT_EMAIL, contactMailto } from '@/constants/legal';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';

export type ModerationBannerKind = 'held' | 'removed' | 'suspended';

const TEXT_KEY: Record<ModerationBannerKind, string> = {
  held: 'moderation.bannerHeld',
  removed: 'moderation.bannerRemoved',
  suspended: 'moderation.bannerSuspended',
};

/**
 * Bannière visible par le seul créateur (017) : contenu masqué le temps
 * d'une vérification, retiré, ou compte suspendu. Toucher → contestation.
 */
export function ModerationBanner({ kind, compact = false }: { kind: ModerationBannerKind; compact?: boolean }) {
  const colors = useColors();
  const { t } = useI18n();
  const contest = () => {
    void Linking.openURL(contactMailto(t('moderation.contestSubject'))).catch(() => {
      Alert.alert(t('moderation.detailsTitle'), t('moderation.contest', { email: CONTACT_EMAIL }));
    });
  };
  return (
    <Pressable
      onPress={contest}
      accessibilityRole="button"
      accessibilityLabel={`${t(TEXT_KEY[kind])} ${t('moderation.contest', { email: CONTACT_EMAIL })}`}
      style={[
        styles.wrap,
        compact && styles.compact,
        { backgroundColor: colors.noirElevated, borderColor: colors.or },
      ]}
    >
      <Ionicons
        name={kind === 'held' ? 'eye-off-outline' : 'shield-outline'}
        size={compact ? 14 : 18}
        color={colors.or}
      />
      <View style={styles.texts}>
        <Text style={[styles.title, compact && styles.titleCompact, { color: colors.sable }]}>
          {t(TEXT_KEY[kind])}
        </Text>
        {compact ? null : (
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {t('moderation.contest', { email: CONTACT_EMAIL })}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginVertical: Spacing.sm,
  },
  compact: { paddingHorizontal: 8, paddingVertical: 4, marginVertical: 4, alignSelf: 'flex-start' },
  texts: { flexShrink: 1 },
  title: { fontFamily: Fonts.medium, fontSize: 13 },
  titleCompact: { fontSize: 11 },
  sub: { fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 },
});

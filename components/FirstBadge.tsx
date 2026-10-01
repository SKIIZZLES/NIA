/**
 * Pastille « First » à côté d'un pseudo : l'un des 100 premiers comptes de
 * NIA (migration 023). Ne rend rien si le compte n'a pas de rang.
 *
 *   <FirstBadge userId={item.userId} username={item.handle} variant="dark" />
 *
 * `rank` force le rang (déjà connu) ; sinon il est lu dans l'annuaire partagé
 * (`lib/firstBadge.ts`). `showRank` affiche « First #12 » (désactivé pour
 * l'instant : décision produit).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts } from '@/constants/theme';
import { firstBadgePalette, type FirstBadgeVariant } from '@/constants/firstBadge';
import { isFirstRank, useFirstRank } from '@/lib/firstBadge';

/** Son propre profil : annuaire rafraîchi au plus toutes les minutes. */
const OWN_MAX_AGE_MS = 60 * 1000;

export type FirstBadgeProps = {
  userId?: string | null;
  username?: string | null;
  /** Rang déjà connu (sinon lu dans l'annuaire). `null` = pas de badge. */
  rank?: number | null;
  /**
   * `theme` (défaut) : suit Apparence. `dark` : posé sur une vidéo / photo, ou
   * écran dessiné en couleurs statiques NIA Original.
   */
  variant?: FirstBadgeVariant;
  size?: 'sm' | 'md';
  showRank?: boolean;
  /** Profil de la personne connectée : libellé d'accessibilité « vous ». */
  own?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function FirstBadge({
  userId,
  username,
  rank: rankProp,
  variant = 'theme',
  size = 'sm',
  showRank = false,
  own = false,
  style,
  testID = 'first-badge',
}: FirstBadgeProps) {
  const looked = useFirstRank({ userId, username }, own ? OWN_MAX_AGE_MS : undefined);
  const rank = rankProp !== undefined ? rankProp : looked;
  const colors = useColors();
  const { t } = useI18n();
  if (!isFirstRank(rank)) return null;

  const palette = firstBadgePalette(colors, variant);
  const label = showRank ? t('badge.firstRank', { rank }) : t('badge.first');
  const a11y = own
    ? t('badge.firstOwnA11y')
    : showRank
      ? t('badge.firstRankA11y', { rank })
      : t('badge.firstA11y');

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={[
        styles.pill,
        size === 'md' ? styles.pillMd : null,
        { backgroundColor: palette.background, borderColor: palette.border },
        style,
      ]}
    >
      <Text
        style={[styles.label, size === 'md' ? styles.labelMd : null, { color: palette.text }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pillMd: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  label: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  labelMd: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default FirstBadge;

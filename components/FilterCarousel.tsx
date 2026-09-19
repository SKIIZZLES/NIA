/**
 * Horizontal filter carousel — category chips + filter swatches.
 * NIA visual identity (sable / ocre / noir). Not Snap branding.
 */
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  FILTER_CATEGORIES,
  FILTERS,
  filtersForCategory,
  type FilterCategoryId,
  type FilterDefinition,
} from '@/constants/filters';

type Props = {
  selectedId: string | null;
  onSelect: (filter: FilterDefinition | null) => void;
  /** Compact mode for create form */
  compact?: boolean;
};

export function FilterCarousel({ selectedId, onSelect, compact }: Props) {
  const { t } = useI18n();
  const colors = useColors();
  const [category, setCategory] = useState<FilterCategoryId>('nia');

  const list = useMemo(() => filtersForCategory(category), [category]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          marginTop: Spacing.md,
        },
        label: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 13,
          marginBottom: 6,
        },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          marginBottom: Spacing.sm,
          lineHeight: 16,
        },
        catScroll: {
          marginBottom: Spacing.sm,
        },
        catRow: {
          flexDirection: 'row',
          gap: 8,
          paddingVertical: 2,
        },
        catChip: {
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
        },
        catChipOn: {
          borderColor: colors.or,
          backgroundColor: 'rgba(209, 127, 42, 0.18)',
        },
        catText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        catTextOn: {
          color: colors.or,
        },
        filterScroll: {
          marginTop: 4,
        },
        filterRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          paddingVertical: 4,
          paddingRight: Spacing.md,
        },
        noneChip: {
          alignItems: 'center',
          width: compact ? 64 : 72,
        },
        noneCircle: {
          width: compact ? 56 : 64,
          height: compact ? 56 : 64,
          borderRadius: Radii.lg,
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: colors.noirElevated,
          alignItems: 'center',
          justifyContent: 'center',
        },
        noneCircleOn: {
          borderColor: colors.or,
        },
        noneDash: {
          width: 22,
          height: 2,
          backgroundColor: colors.textMuted,
          borderRadius: 1,
        },
        chip: {
          alignItems: 'center',
          width: compact ? 64 : 72,
        },
        swatch: {
          width: compact ? 56 : 64,
          height: compact ? 56 : 64,
          borderRadius: Radii.lg,
          borderWidth: 2,
          borderColor: 'transparent',
          overflow: 'hidden',
          backgroundColor: colors.noirSoft,
        },
        swatchOn: {
          borderColor: colors.or,
        },
        swatchInner: {
          flex: 1,
        },
        chipName: {
          marginTop: 6,
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 10,
          textAlign: 'center',
        },
        chipNameOn: {
          color: colors.or,
        },
      }),
    [colors, compact],
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('filter.label')}</Text>
      <Text style={styles.hint}>{t('filter.hint')}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catScroll}
        contentContainerStyle={styles.catRow}
      >
        {FILTER_CATEGORIES.map((c) => {
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
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        <Pressable
          style={styles.noneChip}
          onPress={() => onSelect(null)}
          accessibilityLabel={t('filter.none')}
        >
          <View style={[styles.noneCircle, !selectedId && styles.noneCircleOn]}>
            <View style={styles.noneDash} />
          </View>
          <Text style={[styles.chipName, !selectedId && styles.chipNameOn]}>
            {t('filter.none')}
          </Text>
        </Pressable>

        {list.map((f) => {
          const on = selectedId === f.id;
          return (
            <Pressable
              key={f.id}
              style={styles.chip}
              onPress={() => onSelect(f)}
              accessibilityLabel={f.name}
            >
              <View style={[styles.swatch, on && styles.swatchOn]}>
                <View
                  style={[styles.swatchInner, { backgroundColor: f.previewColor }]}
                />
              </View>
              <Text
                style={[styles.chipName, on && styles.chipNameOn]}
                numberOfLines={1}
              >
                {f.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Count for smoke tests / docs */
export const FILTER_REGISTRY_COUNT = FILTERS.length;

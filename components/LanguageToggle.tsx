import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { APP_LOCALES, type AppLocale } from '@/lib/i18n';

type Props = {
  /** Compact trigger for welcome; fuller label for profile. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function LanguageToggle({ compact, style }: Props) {
  const { locale, setLocale, t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const pick = (next: AppLocale) => {
    if (next !== locale) void setLocale(next);
    setOpen(false);
  };

  const renderItem = ({ item }: ListRenderItemInfo<AppLocale>) => {
    const on = locale === item;
    return (
      <Pressable
        onPress={() => pick(item)}
        style={[styles.row, on && styles.rowOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={t(`language.${item}`)}
      >
        <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>
          {t(`language.${item}`)}
        </Text>
        {on ? (
          <Ionicons name="checkmark" size={20} color={Colors.or} />
        ) : (
          <View style={styles.checkPlaceholder} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]}>
      {!compact ? <Text style={styles.label}>{t('language.label')}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, compact && styles.triggerCompact]}
        accessibilityRole="button"
        accessibilityLabel={t('language.choose')}
        accessibilityHint={t(`language.${locale}`)}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {t(`language.${locale}`)}
        </Text>
        <Ionicons name="chevron-down" size={18} color={Colors.or} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t('language.close')}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm },
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>{t('language.choose')}</Text>
          <FlatList
            data={[...APP_LOCALES]}
            keyExtractor={(code) => code}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
          <Pressable
            style={styles.cancel}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{t('language.close')}</Text>
          </Pressable>
        </View>
      </Modal>
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
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.or,
    backgroundColor: 'rgba(201, 162, 39, 0.12)',
    alignSelf: 'stretch',
    maxWidth: 320,
  },
  triggerCompact: {
    alignSelf: 'center',
    minWidth: 180,
  },
  triggerText: {
    flex: 1,
    color: Colors.or,
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: Colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '72%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
    marginBottom: Spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowOn: {
    backgroundColor: 'rgba(201, 162, 39, 0.1)',
    borderRadius: Radii.sm,
    borderBottomColor: 'transparent',
  },
  rowLabel: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
    flex: 1,
  },
  rowLabelOn: {
    color: Colors.or,
    fontFamily: Fonts.bold,
  },
  checkPlaceholder: {
    width: 20,
    height: 20,
  },
  cancel: {
    marginTop: Spacing.sm,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
});

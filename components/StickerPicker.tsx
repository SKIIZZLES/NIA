/**
 * Grille d'emojis à poser sur la vidéo (sprint S4). Feuille du bas.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { STICKER_EMOJIS } from '@/lib/overlays';

type Props = {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

export function StickerPicker({ visible, onPick, onClose }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.noirElevated, paddingBottom: Math.max(insets.bottom, Spacing.md) },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.sable }]}>{t('create.stickersTitle')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('create.textCancel')}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {STICKER_EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => onPick(e)}
              style={({ pressed }) => [styles.cell, pressed && { backgroundColor: colors.noirSoft }]}
              accessibilityRole="button"
              accessibilityLabel={t('create.stickerA11y', { emoji: e })}
            >
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    maxHeight: '55%',
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: { fontFamily: Fonts.bold, fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  emoji: { fontSize: 30 },
});

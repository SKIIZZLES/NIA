import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { useI18n } from '@/context/I18nContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  canBlock: boolean;
  canReport: boolean;
  /** Owner: show archive + delete */
  canManage?: boolean;
  onReport: () => void;
  onBlock: () => void;
  onShare?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onAddToSeries?: () => void;
};

export function VideoMenuSheet({
  visible,
  onClose,
  canBlock,
  canReport,
  canManage = false,
  onReport,
  onBlock,
  onShare,
  onArchive,
  onDelete,
  onAddToSeries,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('feed.menuTitle')}</Text>
        {onShare ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onShare();
            }}
          >
            <Ionicons name="share-outline" size={22} color={Colors.sable} />
            <Text style={styles.rowLabel}>{t('feed.share')}</Text>
          </Pressable>
        ) : null}

        {canManage && onAddToSeries ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onAddToSeries();
            }}
          >
            <Ionicons name="albums-outline" size={22} color={Colors.or} />
            <Text style={styles.rowLabel}>{t('series.addToSeries')}</Text>
          </Pressable>
        ) : null}
        {canManage && onArchive ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onArchive();
            }}
          >
            <Ionicons name="archive-outline" size={22} color={Colors.or} />
            <Text style={styles.rowLabel}>{t('feed.archive')}</Text>
          </Pressable>
        ) : null}
        {canManage && onDelete ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onDelete();
            }}
          >
            <Ionicons name="trash-outline" size={22} color={Colors.danger} />
            <Text style={[styles.rowLabel, styles.danger]}>{t('feed.delete')}</Text>
          </Pressable>
        ) : null}
        {canReport ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onReport();
            }}
          >
            <Ionicons name="flag-outline" size={22} color={Colors.sable} />
            <Text style={styles.rowLabel}>{t('feed.report')}</Text>
          </Pressable>
        ) : null}
        {canBlock ? (
          <Pressable
            style={styles.row}
            onPress={() => {
              onClose();
              onBlock();
            }}
          >
            <Ionicons name="hand-left-outline" size={22} color={Colors.danger} />
            <Text style={[styles.rowLabel, styles.danger]}>{t('feed.blockUser')}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: Colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  danger: { color: Colors.danger },
  cancel: {
    marginTop: Spacing.md,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
});

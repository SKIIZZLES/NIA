import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import {
  REPORT_REASONS,
  createReport,
  type ReportReasonId,
} from '@/lib/reports';
import type { ReportTargetType } from '@/types/database';

type Props = {
  visible: boolean;
  onClose: () => void;
  reporterId?: string | null;
  targetType: ReportTargetType;
  targetId: string;
  /** Appelé après succès (mock ou persisté) avec message FR */
  onDone?: (message: string) => void;
};

export function ReportSheet({
  visible,
  onClose,
  reporterId,
  targetType,
  targetId,
  onDone,
}: Props) {
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<ReportReasonId | null>(null);

  const submit = async (reason: ReportReasonId) => {
    if (sending) return;
    setSelected(reason);
    setSending(true);
    try {
      const result = await createReport({
        reporterId,
        targetType,
        targetId,
        reason,
      });
      if (!result.ok) {
        onDone?.(result.message);
        return;
      }
      onDone?.(
        result.mock
          ? 'Signalement enregistré (mode démo). Merci.'
          : 'Merci. Votre signalement a été envoyé.',
      );
      onClose();
    } finally {
      setSending(false);
      setSelected(null);
    }
  };

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
        <Text style={styles.title}>Signaler</Text>
        <Text style={styles.subtitle}>
          Pourquoi signalez-vous ce contenu ?
        </Text>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r.id}
            style={styles.row}
            disabled={sending}
            onPress={() => void submit(r.id)}
          >
            <Text style={styles.rowLabel}>{r.label}</Text>
            {sending && selected === r.id ? (
              <ActivityIndicator color={Colors.or} size="small" />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            )}
          </Pressable>
        ))}
        <Pressable style={styles.cancel} onPress={onClose} disabled={sending}>
          <Text style={styles.cancelText}>Annuler</Text>
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
    marginBottom: 4,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
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

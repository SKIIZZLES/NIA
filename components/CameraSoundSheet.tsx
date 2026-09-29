/**
 * Choix du son depuis la caméra NIA (Sprint S1).
 *
 * Reprend la liste « Mes sons » de l'étape Publier. L'import d'un fichier
 * audio reste à l'étape Publier (il demande un titre). Le son retenu remonte
 * dans le CreateContext : l'étape Publier l'affiche déjà et l'associe à la
 * vidéo. La lecture du son pendant le tournage arrive au sprint S2.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { listSoundsByUser, type SoundItem } from '@/lib/sounds';

type Props = {
  visible: boolean;
  selected: SoundItem | null;
  onSelect: (sound: SoundItem | null) => void;
  onClose: () => void;
};

export function CameraSoundSheet({ visible, selected, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();
  const { isMockFeed } = useFeed();
  const [sounds, setSounds] = useState<SoundItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || user.id.startsWith('mock_') || isMockFeed) {
      setSounds([]);
      return;
    }
    setLoading(true);
    try {
      setSounds(await listSoundsByUser(user.id));
    } catch {
      setSounds([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, isMockFeed]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  // Le son choisi depuis la page d'un son n'est pas forcément dans « Mes sons ».
  const list =
    selected && !sounds.some((s) => s.id === selected.id)
      ? [selected, ...sounds]
      : sounds;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.noirElevated,
            paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.sm,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.sable }]}>{t('create.pickSound')}</Text>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t('camera.soundNote')}</Text>

        {selected ? (
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            accessibilityRole="button"
          >
            <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
            <Text style={[styles.rowTitle, { color: colors.danger }]}>
              {t('camera.removeSound')}
            </Text>
          </Pressable>
        ) : null}

        <Text style={[styles.section, { color: colors.textSecondary }]}>
          {t('sound.mySounds')}
        </Text>
        <ScrollView style={styles.list}>
          {loading ? (
            <ActivityIndicator color={colors.or} style={{ marginVertical: Spacing.md }} />
          ) : list.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textMuted }]}>{t('sound.emptyOwn')}</Text>
          ) : (
            list.map((s) => {
              const on = selected?.id === s.id;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    onSelect(s);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name="musical-notes" size={20} color={colors.or} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.rowTitle, { color: on ? colors.or : colors.sable }]}
                      numberOfLines={1}
                    >
                      {s.title}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                      {t('sound.useCount', { count: String(s.useCount) })}
                    </Text>
                  </View>
                  {on ? <Ionicons name="checkmark" size={20} color={colors.or} /> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
          <Text style={[styles.cancelText, { color: colors.textMuted }]}>
            {t('common.cancel')}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '75%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  title: { fontFamily: Fonts.bold, fontSize: 18, marginBottom: 4 },
  hint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginBottom: Spacing.sm },
  section: { fontFamily: Fonts.medium, fontSize: 13, marginTop: Spacing.sm, marginBottom: 4 },
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontFamily: Fonts.medium, fontSize: 15 },
  rowMeta: { fontFamily: Fonts.regular, fontSize: 11, marginTop: 2 },
  cancel: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontFamily: Fonts.medium, fontSize: 15 },
});

/**
 * Choix du son depuis la caméra NIA (Sprint S1).
 *
 * Reprend la liste « Mes sons » de l'étape Publier, et permet d'importer un
 * fichier audio sur place (même logique que Publier : lib/soundImport ; le
 * titre est celui du fichier). Le son importé est choisi d'office. Le son retenu remonte
 * dans le CreateContext : l'étape Publier l'affiche déjà et l'associe à la
 * vidéo. Sprint S2 : écoute du son et choix de son début (SoundTrimControl).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { importSoundFromDevice } from '@/lib/soundImport';
import { SoundTrimControl } from '@/components/SoundTrimControl';

type Props = {
  visible: boolean;
  selected: SoundItem | null;
  onSelect: (sound: SoundItem | null) => void;
  /** Début du son (ms) — brouillon local. */
  offsetMs: number;
  onChangeOffset: (next: number) => void;
  onClose: () => void;
};

export function CameraSoundSheet({
  visible,
  selected,
  onSelect,
  offsetMs,
  onChangeOffset,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();
  const { isMockFeed } = useFeed();
  const [sounds, setSounds] = useState<SoundItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  /** Sons importés depuis cette feuille (utiles en mode démo, sans liste serveur). */
  const [imported, setImported] = useState<SoundItem[]>([]);

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

  const importSound = useCallback(async () => {
    if (!user?.id) {
      Alert.alert(t('feed.loginRequiredTitle'), t('sound.loginRequired'));
      return;
    }
    try {
      const created = await importSoundFromDevice({
        user,
        isMockFeed,
        defaultTitle: t('sound.defaultTitle'),
        onUploadStart: () => setImporting(true),
      });
      if (!created) return;
      setImported((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      onSelect(created);
      // Rafraîchit « Mes sons » (le nouveau son y figure côté serveur).
      void load();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t('sound.uploadFail');
      Alert.alert(t('common.error'), msg);
    } finally {
      setImporting(false);
    }
  }, [user, isMockFeed, t, onSelect, load]);

  // Sons importés ici + « Mes sons » (sans doublon), et le son choisi depuis
  // la page d'un son, qui n'est pas forcément dans « Mes sons ».
  const merged = [...imported, ...sounds.filter((s) => !imported.some((i) => i.id === s.id))];
  const list =
    selected && !merged.some((s) => s.id === selected.id) ? [selected, ...merged] : merged;

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
          <SoundTrimControl
            sound={selected}
            offsetMs={offsetMs}
            onChangeOffset={onChangeOffset}
            paused={!visible}
          />
        ) : null}

        <Pressable
          style={[styles.importBtn, { borderColor: colors.or, opacity: importing ? 0.6 : 1 }]}
          onPress={() => void importSound()}
          disabled={importing}
          accessibilityRole="button"
          accessibilityLabel={t('camera.importSound')}
        >
          {importing ? (
            <ActivityIndicator color={colors.or} />
          ) : (
            <Ionicons name="cloud-upload-outline" size={20} color={colors.or} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.or }]}>
              {importing ? t('camera.importingSound') : t('camera.importSound')}
            </Text>
            <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
              {t('camera.importHint')}
            </Text>
          </View>
        </Pressable>

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
            <View style={styles.empty}>
              <Text style={[styles.hint, { color: colors.textMuted }]}>
                {t('camera.soundEmpty')}
              </Text>
              <Pressable
                onPress={() => void importSound()}
                disabled={importing}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[styles.rowTitle, { color: colors.or }]}>
                  {t('camera.importSound')}
                </Text>
              </Pressable>
            </View>
          ) : (
            list.map((s) => {
              const on = selected?.id === s.id;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  // La feuille reste ouverte : le réglage du début apparaît en haut.
                  onPress={() => onSelect(s)}
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
            {selected ? t('sound.done') : t('common.cancel')}
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
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginTop: Spacing.sm,
  },
  empty: { paddingVertical: Spacing.sm, gap: 6 },
  cancel: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontFamily: Fonts.medium, fontSize: 15 },
});

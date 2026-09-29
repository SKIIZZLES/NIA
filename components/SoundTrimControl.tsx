/**
 * Réglages du son choisi (sprint S2) : écoute, début du son, volume du son
 * original de la vidéo.
 *
 * Les réglages vivent dans le CreateContext (brouillon local) et sont
 * enregistrés avec la vidéo dans `edit_meta` (S5, migration 016) ; les
 * lecteurs appliquent début du son et volumes.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayerStatus } from 'expo-audio';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useSyncedSound } from '@/hooks/useSyncedSound';
import type { SoundItem } from '@/lib/sounds';
import { ORIGINAL_VOLUME_LEVELS, formatSoundTime } from '@/lib/soundSync';

type Props = {
  sound: SoundItem;
  offsetMs: number;
  onChangeOffset: (next: number) => void;
  /** Bouton « Écouter » : lecture autonome depuis le début choisi. */
  previewable?: boolean;
  /** Suspend l'écoute (feuille fermée, tournage en cours…). */
  paused?: boolean;
  /** Affiche le choix du volume original (vidéo uniquement). */
  originalVolume?: number;
  onChangeOriginalVolume?: (next: number) => void;
  /** Affiche la note « réglages locaux ». */
};

const STEPS = [
  { delta: -5000, icon: 'play-back' as const, key: 'sound.startBack5' },
  { delta: -1000, icon: 'chevron-back' as const, key: 'sound.startBack1' },
  { delta: 1000, icon: 'chevron-forward' as const, key: 'sound.startFwd1' },
  { delta: 5000, icon: 'play-forward' as const, key: 'sound.startFwd5' },
];

const VOLUME_KEYS: Record<(typeof ORIGINAL_VOLUME_LEVELS)[number], string> = {
  1: 'sound.volumeNormal',
  0.3: 'sound.volumeLow',
  0: 'sound.volumeMuted',
};

export function SoundTrimControl({
  sound,
  offsetMs,
  onChangeOffset,
  previewable = true,
  paused = false,
  originalVolume,
  onChangeOriginalVolume,
}: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const isFocused = useIsFocused();
  const [listening, setListening] = React.useState(false);

  const player = useSyncedSound({
    url: previewable ? sound.publicUrl || null : null,
    active: previewable && listening && isFocused && !paused,
    offsetMs,
  });
  const status = useAudioPlayerStatus(player);

  // Écoute coupée automatiquement quand l'écran perd le focus ou se met en pause.
  React.useEffect(() => {
    if (!isFocused || paused) setListening(false);
  }, [isFocused, paused]);

  const durationMs =
    sound.durationMs && sound.durationMs > 0
      ? sound.durationMs
      : status.duration > 0
        ? Math.round(status.duration * 1000)
        : null;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.noirElevated }]}>
      <View style={styles.headRow}>
        <Ionicons name="musical-notes" size={20} color={colors.or} />
        <Text style={[styles.title, { color: colors.sable }]} numberOfLines={1}>
          {sound.title}
        </Text>
        {previewable ? (
          <Pressable
            onPress={() => setListening((v) => !v)}
            style={[styles.listenBtn, { backgroundColor: colors.or }]}
            accessibilityRole="button"
            accessibilityLabel={listening ? t('sound.stopListening') : t('sound.listen')}
            hitSlop={6}
          >
            <Ionicons name={listening ? 'pause' : 'play'} size={16} color={colors.noir} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('sound.start', { time: formatSoundTime(offsetMs) })}
        {durationMs ? ` / ${formatSoundTime(durationMs)}` : ''}
      </Text>
      <View style={styles.stepRow}>
        {STEPS.map((s) => {
          const disabled =
            (s.delta < 0 && offsetMs <= 0) ||
            (s.delta > 0 && durationMs != null && offsetMs >= durationMs - 1000);
          return (
            <Pressable
              key={s.key}
              onPress={() => onChangeOffset(offsetMs + s.delta)}
              disabled={disabled}
              style={[
                styles.stepBtn,
                { borderColor: colors.border, opacity: disabled ? 0.4 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(s.key)}
            >
              <Ionicons name={s.icon} size={16} color={colors.sable} />
              <Text style={[styles.stepText, { color: colors.sable }]}>
                {s.delta > 0 ? '+' : '−'}
                {Math.abs(s.delta) / 1000}s
              </Text>
            </Pressable>
          );
        })}
      </View>

      {onChangeOriginalVolume && originalVolume != null ? (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('sound.originalVolume')}
          </Text>
          <View style={styles.stepRow}>
            {ORIGINAL_VOLUME_LEVELS.map((level) => {
              const on = Math.abs(originalVolume - level) < 0.01;
              return (
                <Pressable
                  key={level}
                  onPress={() => onChangeOriginalVolume(level)}
                  style={[
                    styles.volChip,
                    {
                      borderColor: on ? colors.or : colors.border,
                      backgroundColor: on ? colors.or : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.stepText, { color: on ? colors.noir : colors.sable }]}>
                    {t(VOLUME_KEYS[level])}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: 6,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: Fonts.medium, fontSize: 15 },
  listenBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: Fonts.medium, fontSize: 12, marginTop: 4 },
  stepRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stepText: { fontFamily: Fonts.medium, fontSize: 12 },
  volChip: {
    borderWidth: 1,
    borderRadius: Radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  note: { fontFamily: Fonts.regular, fontSize: 11, lineHeight: 15, marginTop: 4 },
});

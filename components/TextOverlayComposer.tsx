/**
 * Saisie d'un texte à poser sur la vidéo (sprint S4) : police, couleur de la
 * palette NIA, fond (aucun / encadré). Aperçu en direct du style.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  MAX_OVERLAY_TEXT,
  OVERLAY_COLORS,
  OVERLAY_COLOR_IDS,
  OVERLAY_FONTS,
  OVERLAY_FONT_IDS,
  textOverlayColors,
  truncateText,
  type OverlayBackground,
  type OverlayColorId,
  type OverlayFontId,
} from '@/lib/overlays';

export type TextStyleValue = {
  text: string;
  font: OverlayFontId;
  color: OverlayColorId;
  bg: OverlayBackground;
};

type Props = {
  visible: boolean;
  initial: TextStyleValue | null;
  /** Texte vide = retirer (ou ne rien créer). */
  onDone: (value: TextStyleValue) => void;
  onCancel: () => void;
};

const DEFAULT_VALUE: TextStyleValue = { text: '', font: 'classique', color: 'sable', bg: 'none' };

export function TextOverlayComposer({ visible, initial, onDone, onCancel }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState<TextStyleValue>(initial ?? DEFAULT_VALUE);

  useEffect(() => {
    if (visible) setValue(initial ?? DEFAULT_VALUE);
  }, [visible, initial]);

  // Retour Android : fermer la saisie, pas quitter l'édition.
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const preview = textOverlayColors(value);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { ...StyleSheet.absoluteFill, backgroundColor: colors.noir + 'CC' },
        top: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: Spacing.md,
        },
        topBtn: { paddingVertical: 8, paddingHorizontal: 4 },
        cancel: { color: colors.onMedia, fontFamily: Fonts.medium, fontSize: 15 },
        done: {
          color: colors.noir,
          backgroundColor: colors.or,
          fontFamily: Fonts.bold,
          fontSize: 15,
          paddingHorizontal: 18,
          paddingVertical: 8,
          borderRadius: Radii.pill,
          overflow: 'hidden',
        },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
        inputBox: { maxWidth: '100%', borderRadius: 10 },
        input: { fontSize: 30, lineHeight: 38, textAlign: 'center', minWidth: 60, padding: 0 },
        counter: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 11, marginTop: 8 },
        tools: { paddingHorizontal: Spacing.md, gap: Spacing.sm },
        row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        fontChip: {
          paddingHorizontal: 14,
          height: 34,
          borderRadius: Radii.pill,
          borderWidth: 1,
          justifyContent: 'center',
        },
        swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
        bgBtn: {
          width: 38,
          height: 38,
          borderRadius: 10,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
      }),
    [colors],
  );

  if (!visible) return null;
  const set = (patch: Partial<TextStyleValue>) => setValue((v) => ({ ...v, ...patch }));
  const count = Array.from(value.text).length;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={onCancel} style={styles.topBtn} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.cancel}>{t('create.textCancel')}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDone({ ...value, text: truncateText(value.text.trim()) })}
          style={styles.topBtn}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.done}>{t('create.textDone')}</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <View
          style={[
            styles.inputBox,
            preview.background
              ? { backgroundColor: preview.background, paddingHorizontal: 12, paddingVertical: 4 }
              : null,
          ]}
        >
          <TextInput
            autoFocus
            multiline
            value={value.text}
            onChangeText={(txt) => set({ text: truncateText(txt) })}
            placeholder={t('create.textPlaceholder')}
            placeholderTextColor={preview.background ? preview.text + '99' : colors.textMuted}
            style={[
              styles.input,
              { color: preview.text, fontFamily: OVERLAY_FONTS[value.font] },
            ]}
            maxLength={MAX_OVERLAY_TEXT * 2}
            accessibilityLabel={t('create.textPlaceholder')}
          />
        </View>
        <Text style={styles.counter}>{`${count}/${MAX_OVERLAY_TEXT}`}</Text>
      </View>

      <View style={[styles.tools, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
          <View style={styles.row}>
            <Pressable
              onPress={() => set({ bg: value.bg === 'box' ? 'none' : 'box' })}
              style={[
                styles.bgBtn,
                {
                  borderColor: value.bg === 'box' ? colors.or : colors.border,
                  backgroundColor: value.bg === 'box' ? colors.or : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: value.bg === 'box' }}
              accessibilityLabel={value.bg === 'box' ? t('create.textBgBox') : t('create.textBgNone')}
            >
              <Ionicons name="text" size={20} color={value.bg === 'box' ? colors.noir : colors.onMedia} />
            </Pressable>
            {OVERLAY_FONT_IDS.map((f) => {
              const on = value.font === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => set({ font: f })}
                  style={[
                    styles.fontChip,
                    {
                      borderColor: on ? colors.or : colors.border,
                      backgroundColor: on ? colors.or : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t('create.textFont', { font: f })}
                >
                  <Text style={{ fontFamily: OVERLAY_FONTS[f], fontSize: 15, color: on ? colors.noir : colors.onMedia }}>
                    Aa
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
          <View style={styles.row}>
            {OVERLAY_COLOR_IDS.map((c) => {
              const on = value.color === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => set({ color: c })}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: OVERLAY_COLORS[c],
                      borderColor: on ? colors.or : colors.border,
                      transform: [{ scale: on ? 1.15 : 1 }],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t('create.textColor', { color: c })}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

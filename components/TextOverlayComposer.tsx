/**
 * Saisie d'un texte à poser sur la vidéo (sprint S4) : police, couleur de la
 * palette NIA, fond. Aperçu en direct du style.
 *
 * Éditeur V2 (façon Instagram) : sept styles de police, trois fonds (aucun,
 * pastille pleine, pastille semi-transparente), alignement gauche / centre /
 * droite. Le rendu vient de `textOverlayLook`, comme l'aperçu et l'image
 * incrustée dans la vidéo.
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
  OVERLAY_ALIGNS,
  OVERLAY_BACKGROUNDS,
  OVERLAY_COLORS,
  OVERLAY_COLOR_IDS,
  OVERLAY_FONTS,
  OVERLAY_FONT_CHOICES,
  textOverlayLook,
  truncateText,
  type OverlayAlign,
  type OverlayBackground,
  type OverlayColorId,
  type OverlayFontId,
} from '@/lib/overlays';

export type TextStyleValue = {
  text: string;
  font: OverlayFontId;
  color: OverlayColorId;
  bg: OverlayBackground;
  align: OverlayAlign;
};

type Props = {
  visible: boolean;
  initial: TextStyleValue | null;
  /** Texte vide = retirer (ou ne rien créer). */
  onDone: (value: TextStyleValue) => void;
  onCancel: () => void;
};

const DEFAULT_VALUE: TextStyleValue = {
  text: '',
  font: 'classique',
  color: 'sable',
  bg: 'none',
  align: 'center',
};

const FONT_LABEL_KEY: Record<string, string> = {
  classique: 'habillage.fontClassique',
  machine: 'habillage.fontMachine',
  neon: 'habillage.fontNeon',
  manuscrit: 'habillage.fontManuscrit',
  condense: 'habillage.fontCondense',
  serif: 'habillage.fontSerif',
  arrondi: 'habillage.fontArrondi',
};
const BG_LABEL_KEY: Record<OverlayBackground, string> = {
  none: 'habillage.bgNone',
  box: 'habillage.bgBox',
  soft: 'habillage.bgSoft',
};
const ALIGN_LABEL_KEY: Record<OverlayAlign, string> = {
  center: 'habillage.alignCenter',
  left: 'habillage.alignLeft',
  right: 'habillage.alignRight',
};

function nextOf<T>(list: readonly T[], cur: T): T {
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length] as T;
}

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

  const INPUT_SIZE = 30;
  const preview = textOverlayLook(value, INPUT_SIZE);
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
        input: { minWidth: 60, padding: 0 },
        counter: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 11, marginTop: 8 },
        tools: { paddingHorizontal: Spacing.md, gap: Spacing.sm },
        row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        fontChip: {
          paddingHorizontal: 12,
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
              ? {
                  backgroundColor: preview.background,
                  paddingHorizontal: preview.paddingH,
                  paddingVertical: preview.paddingV,
                  borderRadius: preview.borderRadius,
                }
              : null,
          ]}
        >
          <TextInput
            autoFocus
            multiline
            value={value.text}
            onChangeText={(txt) => set({ text: truncateText(txt) })}
            placeholder={t('create.textPlaceholder')}
            placeholderTextColor={preview.background ? preview.color + '99' : colors.textMuted}
            style={[
              styles.input,
              {
                color: preview.color,
                fontFamily: preview.fontFamily,
                fontSize: preview.fontSize,
                lineHeight: preview.lineHeight,
                textAlign: preview.textAlign,
              },
              preview.shadow
                ? {
                    textShadowColor: preview.shadow.color,
                    textShadowOffset: { width: preview.shadow.dx, height: preview.shadow.dy },
                    textShadowRadius: preview.shadow.radius,
                  }
                : null,
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
              onPress={() => set({ bg: nextOf(OVERLAY_BACKGROUNDS, value.bg) })}
              style={[
                styles.bgBtn,
                {
                  borderColor: value.bg === 'none' ? colors.border : colors.or,
                  backgroundColor:
                    value.bg === 'box' ? colors.or : value.bg === 'soft' ? colors.or + '66' : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('habillage.bgA11y', { name: t(BG_LABEL_KEY[value.bg]) })}
            >
              <Ionicons name="text" size={20} color={value.bg === 'box' ? colors.noir : colors.onMedia} />
            </Pressable>
            <Pressable
              onPress={() => set({ align: nextOf(OVERLAY_ALIGNS, value.align) })}
              style={[styles.bgBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('habillage.alignA11y', { name: t(ALIGN_LABEL_KEY[value.align]) })}
            >
              <View style={{ alignItems: value.align === 'left' ? 'flex-start' : value.align === 'right' ? 'flex-end' : 'center', width: 20 }}>
                {[16, 10, 14].map((w, i) => (
                  <View
                    key={i}
                    style={{ width: value.align === 'center' ? w : w + 2, height: 2, borderRadius: 1, marginVertical: 1.5, backgroundColor: colors.onMedia }}
                  />
                ))}
              </View>
            </Pressable>
            {OVERLAY_FONT_CHOICES.map((f) => {
              const on = value.font === f;
              const name = t(FONT_LABEL_KEY[f] ?? 'habillage.fontClassique');
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
                  accessibilityLabel={t('habillage.fontA11y', { name })}
                >
                  <Text
                    style={{ fontFamily: OVERLAY_FONTS[f], fontSize: 15, color: on ? colors.noir : colors.onMedia }}
                    numberOfLines={1}
                  >
                    {name}
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

/**
 * Suggestions #hashtag / @pseudo sous la légende (sprint S5) : hashtags déjà
 * utilisés sur NIA (vidéos récentes) et profils existants. Toucher une
 * suggestion remplace le mot en cours.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { currentMentionToken } from '@/lib/publishOptions';
import { suggestHashtags, suggestProfiles } from '@/lib/videos';

type Props = {
  text: string;
  cursor: number;
  onPick: (token: NonNullable<ReturnType<typeof currentMentionToken>>, value: string) => void;
  enabled: boolean;
};

const DEBOUNCE_MS = 250;

export function MentionSuggestions({ text, cursor, onPick, enabled }: Props) {
  const colors = useColors();
  const token = useMemo(() => (enabled ? currentMentionToken(text, cursor) : null), [text, cursor, enabled]);
  const [items, setItems] = useState<string[]>([]);
  const key = token ? `${token.kind}${token.query}` : '';

  useEffect(() => {
    if (!token) {
      setItems([]);
      return;
    }
    // Un @ seul ne liste pas tous les profils : au moins une lettre.
    if (token.kind === '@' && token.query.length < 1) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found =
            token.kind === '#'
              ? await suggestHashtags(token.query)
              : (await suggestProfiles(token.query)).map((p) => p.username);
          if (alive) setItems(found.filter((f) => f.toLowerCase() !== token.query));
        } catch {
          if (alive) setItems([]);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // La clé résume le mot en cours ; token change d'identité à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!token || items.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((it) => (
        <Pressable
          key={it}
          onPress={() => onPick(token, it)}
          style={[styles.chip, { borderColor: colors.or, backgroundColor: colors.noirSoft }]}
          accessibilityRole="button"
        >
          <Text style={[styles.text, { color: colors.sable }]}>{`${token.kind}${it}`}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingVertical: Spacing.sm },
  chip: { borderWidth: 1, borderRadius: Radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  text: { fontFamily: Fonts.medium, fontSize: 13 },
});

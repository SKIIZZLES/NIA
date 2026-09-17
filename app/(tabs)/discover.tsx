import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

type Category = {
  id: string;
  label: string;
  blurb: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CATEGORIES: Category[] = [
  {
    id: 'afrique',
    label: 'Afrique',
    blurb: 'Créations nées sur le continent',
    icon: 'globe-outline',
  },
  {
    id: 'diaspora',
    label: 'Diaspora',
    blurb: 'Voix et récits hors frontières',
    icon: 'airplane-outline',
  },
  {
    id: 'culture',
    label: 'Culture',
    blurb: 'Arts, langues, patrimoine vivant',
    icon: 'library-outline',
  },
  {
    id: 'musique',
    label: 'Musique',
    blurb: 'Afrobeats, jazz, tradition & scène',
    icon: 'musical-notes-outline',
  },
  {
    id: 'mode',
    label: 'Mode',
    blurb: 'Style, design & maison créative',
    icon: 'shirt-outline',
  },
  {
    id: 'tech',
    label: 'Tech & Innovation',
    blurb: 'Builders, startups, futur afro-tech',
    icon: 'hardware-chip-outline',
  },
  {
    id: 'food',
    label: 'Gastronomie',
    blurb: 'Saveurs, chefs & tables urbaines',
    icon: 'restaurant-outline',
  },
  {
    id: 'sport',
    label: 'Sport',
    blurb: 'Talents, clubs & moments forts',
    icon: 'football-outline',
  },
];

export default function DiscoverScreen() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.blurb.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Découvrir</Text>
      <Text style={styles.subtitle}>
        Explorez les scènes, cultures et talents — filtrez par univers.
      </Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Catégories, scènes, thèmes…"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Recherche dans Découvrir"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.section}>Univers</Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const active = selected === item.id;
          return (
            <Pressable
              style={[styles.card, active && styles.cardActive]}
              onPress={() => setSelected(active ? null : item.id)}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={active ? Colors.noir : Colors.or}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.label}</Text>
                <Text style={styles.cardBlurb}>{item.blurb}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={Colors.textMuted}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="compass-outline" size={40} color={Colors.or} />
            <Text style={styles.emptyTitle}>Aucun univers trouvé</Text>
            <Text style={styles.emptyBody}>
              Essayez un autre mot-clé. La recherche full-text arrive bientôt.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerNote}>
            <Ionicons name="sparkles-outline" size={16} color={Colors.or} />
            <Text style={styles.footerText}>
              Contenu par catégorie branché au Sprint 2 (vidéos + filtres).
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.noir, paddingHorizontal: Spacing.lg },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 6,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.noirSoft,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  section: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  listContent: { paddingBottom: Spacing.xxl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardActive: {
    borderColor: Colors.or,
    backgroundColor: Colors.noirSoft,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radii.sm,
    backgroundColor: Colors.noirSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.35)',
  },
  iconWrapActive: {
    backgroundColor: Colors.or,
    borderColor: Colors.or,
  },
  cardBody: { flex: 1 },
  cardTitle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 15,
  },
  cardBlurb: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.md,
    gap: 10,
  },
  emptyTitle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  emptyBody: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  footerText: {
    flex: 1,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});

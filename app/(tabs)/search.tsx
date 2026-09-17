import React, { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

const SUGGESTIONS = [
  'Afrobeats',
  'Danse traditionnelle',
  'Mode Lagos',
  'Cuisine sénégalaise',
  'Street art Dakar',
  'Créateurs Ghana',
  'Nollywood shorts',
  'Paysages Maghreb',
];

export default function SearchScreen() {
  const [q, setQ] = useState('');
  const filtered = SUGGESTIONS.filter((s) =>
    s.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Recherche</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="Cultures, talents, pays…"
          placeholderTextColor={Colors.textMuted}
        />
      </View>
      <Text style={styles.section}>Suggestions</Text>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Ionicons name="trending-up" size={18} color={Colors.or} />
            <Text style={styles.rowText}>{item}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun résultat (placeholder MVP)</Text>
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
    marginBottom: Spacing.md,
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowText: {
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 15,
  },
  empty: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    marginTop: Spacing.lg,
  },
});

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '@/constants/theme';

const MOCK_THREADS = [
  { id: '1', name: 'Aminata', preview: 'Merci pour le partage ! 🙌', time: '2 min' },
  { id: '2', name: 'Kwame Studio', preview: 'Collab la semaine prochaine ?', time: '1 h' },
  { id: '3', name: 'NIA Équipe', preview: 'Bienvenue sur NIA ✨', time: 'Hier' },
];

export default function MessagesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Messages</Text>
      <Text style={styles.hint}>Placeholder MVP — messagerie réelle plus tard.</Text>
      <FlatList
        data={MOCK_THREADS}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>{item.name[0]}</Text>
            </View>
            <View style={styles.body}>
              <View style={styles.topLine}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.time}>{item.time}</Text>
              </View>
              <Text style={styles.preview} numberOfLines={1}>
                {item.preview}
              </Text>
            </View>
          </View>
        )}
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
  hint: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    marginBottom: Spacing.lg,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.terre,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
  },
  body: { flex: 1 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: Colors.sable, fontFamily: Fonts.bold, fontSize: 15 },
  time: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12 },
  preview: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
  },
});

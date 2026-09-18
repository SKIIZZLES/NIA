import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NiaWordmark } from '@/components/NiaWordmark';
import { Button } from '@/components/Button';
import { Colors, Fonts, HeroLines, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';

export default function WelcomeScreen() {
  const router = useRouter();
  const { isMockAuth } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <NiaWordmark size={72} showTagline />
        {isMockAuth ? (
          <View style={[styles.badge, { backgroundColor: Colors.terre }]}>
            <Text style={styles.badgeText}>AUTH MOCK MVP</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroPrimary}>{HeroLines.primary}</Text>
        <Text style={styles.heroSecondary}>{HeroLines.secondary}</Text>
      </View>

      <View style={styles.actions}>
        <Button
          title="Créer un compte"
          variant="filled"
          onPress={() => router.push('/(auth)/register')}
        />
        <Button
          title="Se connecter"
          variant="outline"
          onPress={() => router.push('/(auth)/login')}
          style={{ marginTop: Spacing.md }}
        />
        <Text style={styles.mockHint}>
          {isMockAuth
            ? 'Expo Go natif = auth mock · Supabase complet via web ou build natif'
            : 'Auth Supabase connectée'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.noir,
    paddingHorizontal: Spacing.lg,
  },
  top: {
    marginTop: Spacing.xxl,
    alignItems: 'center',
  },
  badge: {
    marginTop: Spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  heroPrimary: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  heroSecondary: {
    marginTop: Spacing.md,
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    paddingBottom: Spacing.xl,
  },
  mockHint: {
    marginTop: Spacing.md,
    textAlign: 'center',
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
});

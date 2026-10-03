import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NiaWordmark } from '@/components/NiaWordmark';
import { Button } from '@/components/Button';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function WelcomeScreen() {
  const router = useRouter();
  const { isMockAuth } = useAuth();
  const { t } = useI18n();
  const colors = useColors();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: {
          flex: 1,
          backgroundColor: colors.noir,
          paddingHorizontal: Spacing.lg,
        },
        top: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: Spacing.lg,
        },
        content: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
        signature: { width: 28, height: 3, borderRadius: 2, backgroundColor: colors.or, marginTop: Spacing.lg },
        badge: {
          marginTop: Spacing.md,
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: 999,
        },
        badgeText: {
          color: colors.onMedia,
          fontFamily: Fonts.bold,
          fontSize: 11,
          letterSpacing: 0.6,
        },
        subtitle: {
          marginTop: Spacing.lg,
          maxWidth: 280,
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 16,
          lineHeight: 24,
          textAlign: 'center',
        },
        actions: {
          paddingBottom: Spacing.xl,
        },
        mockHint: {
          marginTop: Spacing.md,
          textAlign: 'center',
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <NiaWordmark size={84} showTagline />
          <View style={styles.signature} />
          <Text style={styles.subtitle}>{t('brand.heroSecondary')}</Text>
          {isMockAuth ? (
            <View style={[styles.badge, { backgroundColor: colors.terre }]}>
              <Text style={styles.badgeText}>{t('welcome.authMockBadge')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            title={t('welcome.createAccount')}
            variant="filled"
            onPress={() => router.push('/(auth)/register')}
          />
          <Button
            title={t('welcome.signIn')}
            variant="outline"
            onPress={() => router.push('/(auth)/login')}
            style={{ marginTop: Spacing.md }}
          />
          <GoogleSignInButton />
          <LanguageToggle compact />
          {isMockAuth ? <Text style={styles.mockHint}>{t('welcome.mockHint')}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

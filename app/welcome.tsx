import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { SnapchatSignInButton } from '@/components/SnapchatSignInButton';

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
          color: colors.onMedia,
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
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 28,
          lineHeight: 36,
          letterSpacing: -0.3,
        },
        heroSecondary: {
          marginTop: Spacing.md,
          color: colors.textSecondary,
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
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <NiaWordmark size={72} showTagline />
        {isMockAuth ? (
          <View style={[styles.badge, { backgroundColor: colors.terre }]}>
            <Text style={styles.badgeText}>{t('welcome.authMockBadge')}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroPrimary}>{t('brand.heroPrimary')}</Text>
        <Text style={styles.heroSecondary}>{t('brand.heroSecondary')}</Text>
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
        <SnapchatSignInButton />
        <LanguageToggle compact />
        <Text style={styles.mockHint}>
          {isMockAuth ? t('welcome.mockHint') : t('welcome.supabaseHint')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

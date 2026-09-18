import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { isGoogleAuthConfigured } from '@/lib/googleAuth';

type Props = {
  /** Afficher un séparateur « ou » au-dessus */
  showDivider?: boolean;
  style?: object;
};

/**
 * Bouton « Continuer avec Google » — welcome / login / register.
 */
export function GoogleSignInButton({ showDivider = true, style }: Props) {
  const { signInWithGoogle, isMockAuth } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onPress = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err?.code === 'CANCELLED' || err?.message?.includes('annulée')) {
        return;
      }
      Alert.alert(t('google.alertTitle'), err?.message || t('google.fail'));
    } finally {
      setLoading(false);
    }
  };

  const hint =
    Platform.OS === 'web'
      ? t('google.hintWeb')
      : isMockAuth
        ? t('google.hintMock')
        : !isGoogleAuthConfigured()
          ? t('google.hintMissingId')
          : null;

  return (
    <View style={[styles.wrap, style]}>
      {showDivider ? (
        <View style={styles.dividerRow}>
          <View style={styles.line} />
          <Text style={styles.ou}>{t('common.or')}</Text>
          <View style={styles.line} />
        </View>
      ) : null}
      <Button
        title={t('google.continue')}
        variant="outline"
        loading={loading}
        onPress={onPress}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  ou: {
    marginHorizontal: 12,
    color: Colors.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 12,
  },
  hint: {
    marginTop: Spacing.sm,
    textAlign: 'center',
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
  },
});

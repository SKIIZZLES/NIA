import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
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
      Alert.alert('Google', err?.message || 'Connexion Google impossible');
    } finally {
      setLoading(false);
    }
  };

  const hint =
    Platform.OS === 'web'
      ? 'Google natif = build EAS Android/iOS'
      : isMockAuth
        ? 'Mode mock : session locale (Expo Go ou env manquantes)'
        : !isGoogleAuthConfigured()
          ? 'Définissez EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (EAS)'
          : null;

  return (
    <View style={[styles.wrap, style]}>
      {showDivider ? (
        <View style={styles.dividerRow}>
          <View style={styles.line} />
          <Text style={styles.ou}>ou</Text>
          <View style={styles.line} />
        </View>
      ) : null}
      <Button
        title="Continuer avec Google"
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

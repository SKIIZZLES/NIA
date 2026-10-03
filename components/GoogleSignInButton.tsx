import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
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
  const colors = useColors();
  // Couleurs du thème actif : le séparateur « ou » reste lisible dans les sept
  // choix d'Apparence (textMuted ≥ 4.5:1 sur noir, cf. themeContrast.test.ts).
  const styles = useMemo(
    () =>
      StyleSheet.create({
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
          backgroundColor: colors.borderStrong,
        },
        ou: {
          marginHorizontal: 12,
          color: colors.textMuted,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
      }),
    [colors],
  );

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

  // Informations de configuration réservées aux développeurs : jamais affichées
  // dans l'interface, seulement dans la console en développement.
  useEffect(() => {
    if (!__DEV__) return;
    if (Platform.OS === 'web') {
      console.info('[NIA] Google natif : disponible uniquement dans un build EAS Android/iOS.');
    } else if (isMockAuth) {
      console.info('[NIA] Google : mode démo (session locale, variables Supabase absentes).');
    } else if (!isGoogleAuthConfigured()) {
      console.info('[NIA] Google : EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID manquant (EAS).');
    }
  }, [isMockAuth]);

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
    </View>
  );
}

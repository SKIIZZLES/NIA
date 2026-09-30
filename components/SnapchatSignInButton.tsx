import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  isSnapchatAuthConfigured,
  snapchatConfigHintKind,
} from '@/lib/snapchatAuth';
import {
  SNAP_APP_SWITCH_DEFAULT,
  SNAP_ERR,
  type SnapAppSwitchVariant,
} from '@/lib/snapchatAppSwitch';
import { getSnapVariant, setSnapVariant } from '@/lib/snapchatAppSwitchRuntime';

type Props = {
  /** Afficher un séparateur « ou » au-dessus (souvent false si Google déjà affiché) */
  showDivider?: boolean;
  style?: object;
};

const VARIANT_LABEL_KEY: Record<SnapAppSwitchVariant, string> = {
  https: 'snapchat.devModeHttps',
  snapchat: 'snapchat.devModeApp',
  web: 'snapchat.devModeWeb',
};

/**
 * Bouton « Continuer avec Snapchat » — welcome / login / register.
 *
 * Spike app-switch : appui long (1,5 s) sur Android = réglage caché de test
 * pour choisir le lien (https, snapchat://, page web). Le choix est gardé sur
 * le téléphone et rappelé sous le bouton tant qu'il diffère du défaut.
 */
export function SnapchatSignInButton({ showDivider = false, style }: Props) {
  const { signInWithSnapchat, isMockAuth } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<SnapAppSwitchVariant>(SNAP_APP_SWITCH_DEFAULT);

  useEffect(() => {
    let alive = true;
    void getSnapVariant().then((v) => {
      if (alive) setVariant(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onPress = async () => {
    setLoading(true);
    try {
      const result = await signInWithSnapchat();
      if (result === 'signed_in') router.replace('/(tabs)');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err?.code === SNAP_ERR.handled) return; // l'écran de retour a affiché le message
      if (err?.code === 'CANCELLED' || err?.message?.includes('annulée')) {
        return;
      }
      if (err?.code === SNAP_ERR.returned) {
        Alert.alert(t('snapchat.alertTitle'), t('snapchat.returnedWithoutFinishing'));
        return;
      }
      if (err?.code === SNAP_ERR.timeout) {
        Alert.alert(t('snapchat.alertTitle'), t('snapchat.timeout'));
        return;
      }
      Alert.alert(t('snapchat.alertTitle'), err?.message || t('snapchat.fail'));
    } finally {
      setLoading(false);
    }
  };

  const choose = useCallback((v: SnapAppSwitchVariant) => {
    setVariant(v);
    void setSnapVariant(v);
  }, []);

  const onLongPress = useCallback(() => {
    Alert.alert(
      t('snapchat.devModeTitle'),
      t('snapchat.devModeBody', { mode: t(VARIANT_LABEL_KEY[variant]) }),
      [
        { text: t('snapchat.devModeHttps'), onPress: () => choose('https') },
        { text: t('snapchat.devModeApp'), onPress: () => choose('snapchat') },
        { text: t('snapchat.devModeWeb'), onPress: () => choose('web') },
      ],
      { cancelable: true },
    );
  }, [t, variant, choose]);

  const kind = snapchatConfigHintKind();
  const hint =
    isMockAuth
      ? t('snapchat.hintMock')
      : !isSnapchatAuthConfigured() || kind === 'missing_client'
        ? t('snapchat.hintMissingId')
        : kind === 'missing_supabase'
          ? t('snapchat.hintMissingFn')
          : null;
  const modeHint =
    Platform.OS === 'android' && variant !== SNAP_APP_SWITCH_DEFAULT
      ? t('snapchat.devModeHint', { mode: t(VARIANT_LABEL_KEY[variant]) })
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
        title={t('snapchat.continue')}
        variant="outline"
        loading={loading}
        onPress={onPress}
        onLongPress={Platform.OS === 'android' ? onLongPress : undefined}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {modeHint ? <Text style={styles.hint}>{modeHint}</Text> : null}
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

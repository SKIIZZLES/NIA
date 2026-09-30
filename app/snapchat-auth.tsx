/**
 * Écran de retour Snapchat : `nia://snapchat-auth?code=…&state=…`.
 *
 * Spike app-switch (Android) : Snapchat — ou la page https — renvoie ici.
 * L'écran :
 *   1. s'efface si le `state` est celui du flux web (Custom Tab), déjà traité
 *      par expo-auth-session ;
 *   2. sinon valide le `state` contre la demande gardée dans SecureStore
 *      (usage unique, 10 min max) ;
 *   3. envoie code + code_verifier à l'Edge Function `snapchat-auth` ;
 *   4. ouvre le fil, ou affiche un message clair (« vous ») avec un bouton
 *      pour revenir à la connexion.
 *
 * Fonctionne aussi si Android a fermé NIA pendant le passage dans Snapchat.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { isSnapchatWebFlowState } from '@/lib/snapchatAuth';
import {
  snapReturnFailureKey,
  snapReturnFromRouteParams,
  validateSnapReturn,
} from '@/lib/snapchatAppSwitch';
import {
  clearPendingSnapAuth,
  loadPendingSnapAuth,
  notifySnapReturnReceived,
  settleSnapReturn,
} from '@/lib/snapchatAppSwitchRuntime';

export default function SnapchatAuthReturnScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const { completeSnapchatSignIn } = useAuth();
  const { t } = useI18n();
  const colors = useColors();
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ret = snapReturnFromRouteParams(params as Record<string, unknown>);

    // Flux web (Custom Tab) : expo-auth-session a déjà le code, on s'efface.
    if (isSnapchatWebFlowState(ret.state)) {
      if (router.canGoBack()) router.back();
      return;
    }

    notifySnapReturnReceived();

    void (async () => {
      const pending = await loadPendingSnapAuth();
      const check = validateSnapReturn(pending, ret, Date.now());
      // Usage unique, quel que soit le résultat.
      await clearPendingSnapAuth();

      if (!check.ok) {
        settleSnapReturn('failed');
        setMessage(t(snapReturnFailureKey(check.reason)));
        return;
      }

      try {
        await completeSnapchatSignIn({
          code: check.code,
          codeVerifier: check.codeVerifier,
          redirectUri: check.redirectUri,
        });
        settleSnapReturn('signed_in');
        router.replace('/(tabs)');
      } catch (e) {
        settleSnapReturn('failed');
        const detail = e instanceof Error && e.message ? e.message : '';
        setMessage(detail ? `${t('snapchat.returnError')}\n\n${detail}` : t('snapchat.returnError'));
      }
    })();
    // Une seule exécution par ouverture de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.noir,
          alignItems: 'center',
          justifyContent: 'center',
          padding: Spacing.lg,
        },
        text: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 16,
          textAlign: 'center',
          marginTop: Spacing.md,
          marginBottom: Spacing.lg,
          lineHeight: 22,
        },
        button: { alignSelf: 'stretch' },
      }),
    [colors],
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  };

  return (
    <View style={styles.root}>
      {message ? (
        <>
          <Text style={styles.text} accessibilityRole="alert">
            {message}
          </Text>
          <Button title={t('snapchat.returnBack')} onPress={goBack} style={styles.button} />
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.or} />
          <Text style={styles.text}>{t('snapchat.returnFinishing')}</Text>
        </>
      )}
    </View>
  );
}

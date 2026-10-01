/**
 * Modale « date de naissance » (migration 020), par-dessus toute l'app.
 *
 * Affichée à un compte connecté qui n'a pas encore déclaré sa date, quand
 * BIRTHDATE_PROMPT vaut 'required' (lib/age.ts) : anciens comptes, comptes
 * Google / ex-Snapchat, ou date d'inscription perdue. Âge minimum non atteint :
 * écran de refus et déconnexion ; aucun nouvel essai immédiat sur l'appareil.
 * Sans 020 (supported: false) ou hors connexion : rien n'est affiché.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { BirthDateInput, EMPTY_BIRTH_DATE } from '@/components/BirthDateInput';
import { useAge } from '@/context/AgeContext';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { CONTACT_EMAIL, contactMailto } from '@/constants/legal';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  BIRTHDATE_PROMPT,
  birthDateCheckErrorKey,
  checkBirthDate,
  formatBirthDate,
  isAgeRefused,
  isOldEnoughToSignUp,
  markAgeRefused,
  type BirthDateParts,
} from '@/lib/age';

export function AgeGate() {
  const { user, signOut } = useAuth();
  const { status, loading, declare } = useAge();
  const { t } = useI18n();
  const colors = useColors();
  const [parts, setParts] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  const needed =
    BIRTHDATE_PROMPT === 'required' && !!user && !loading && status.supported && !status.declared;

  useEffect(() => {
    if (!needed) return;
    let alive = true;
    void isAgeRefused().then((r) => {
      if (alive && r) setRefused(true);
    });
    return () => {
      alive = false;
    };
  }, [needed]);

  useEffect(() => {
    if (!user) {
      setParts(EMPTY_BIRTH_DATE);
      setRefused(false);
    }
  }, [user]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: { flex: 1, backgroundColor: 'rgba(11,11,11,0.92)', justifyContent: 'center' },
        card: {
          margin: Spacing.lg,
          padding: Spacing.lg,
          borderRadius: Radii.lg,
          backgroundColor: colors.noirElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          gap: Spacing.md,
        },
        icon: { alignSelf: 'center' },
        title: { color: colors.sable, fontFamily: Fonts.bold, fontSize: 19, textAlign: 'center' },
        body: { color: colors.textSecondary, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20 },
        hint: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17 },
        link: { color: colors.or, fontFamily: Fonts.medium, fontSize: 13, textAlign: 'center' },
      }),
    [colors],
  );

  if (!needed) return null;

  const submit = () => {
    const check = checkBirthDate(parts);
    if (!check.ok) {
      Alert.alert(t('common.error'), t(birthDateCheckErrorKey(check.reason)));
      return;
    }
    if (!isOldEnoughToSignUp(check.age, status.minAge)) {
      void markAgeRefused();
      setRefused(true);
      return;
    }
    Alert.alert(t('age.confirmTitle'), t('age.confirmBody', { date: formatBirthDate(check.iso) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('age.confirm'),
        onPress: () => {
          void (async () => {
            setBusy(true);
            const r = await declare(check.iso);
            setBusy(false);
            if (r.ok) return;
            if (r.tooYoung) {
              setRefused(true);
              return;
            }
            Alert.alert(t('common.error'), t(r.errorKey, { email: CONTACT_EMAIL }));
          })();
        },
      },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            {refused ? (
              <View style={styles.card} accessibilityViewIsModal>
                <Ionicons name="hand-left-outline" size={36} color={colors.or} style={styles.icon} />
                <Text style={styles.title}>{t('age.tooYoungTitle')}</Text>
                <Text style={styles.body}>{t('age.tooYoungBody', { age: status.minAge })}</Text>
                <Text
                  style={styles.link}
                  accessibilityRole="link"
                  onPress={() => {
                    void Linking.openURL(contactMailto(t('safety.contactSubject'))).catch(() => undefined);
                  }}
                >
                  {t('age.tooYoungContact', { email: CONTACT_EMAIL })}
                </Text>
                <Button title={t('age.gateSignOut')} variant="filled" onPress={() => void signOut()} />
              </View>
            ) : (
              <View style={styles.card} accessibilityViewIsModal>
                <Ionicons name="calendar-outline" size={36} color={colors.or} style={styles.icon} />
                <Text style={styles.title}>{t('age.gateTitle')}</Text>
                <Text style={styles.body}>{t('age.gateBody', { age: status.minAge })}</Text>
                <BirthDateInput value={parts} onChange={setParts} editable={!busy} />
                <Text style={styles.hint}>{t('age.birthDateHint')}</Text>
                <Button title={t('age.gateConfirm')} variant="filled" loading={busy} onPress={submit} />
                <Button title={t('age.gateSignOut')} variant="ghost" disabled={busy} onPress={() => void signOut()} />
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

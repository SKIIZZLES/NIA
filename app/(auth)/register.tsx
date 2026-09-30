import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  communityGuidelinesUrl,
  isReservedSignupEmail,
  privacyPolicyUrl,
  termsOfServiceUrl,
} from '@/constants/legal';
import { BirthDateInput, EMPTY_BIRTH_DATE } from '@/components/BirthDateInput';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import {
  MIN_SIGNUP_AGE,
  birthDateCheckErrorKey,
  checkBirthDate,
  isAgeRefused,
  isOldEnoughToSignUp,
  markAgeRefused,
  savePendingBirthDate,
  type BirthDateParts,
} from '@/lib/age';
import { checkText, isTextRefusedError } from '@/lib/textFilter';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { SnapchatSignInButton } from '@/components/SnapchatSignInButton';
import { PaletteScope } from '@/context/ThemeContext';
import { ORIGINAL_COLORS } from '@/constants/themes';

/**
 * Écran encore dessiné avec les couleurs statiques de NIA Original : ses
 * composants thémés (Button) suivent la même palette, pas le thème choisi.
 */
export default function RegisterScreen() {
  return (
    <PaletteScope palette={ORIGINAL_COLORS}>
      <RegisterScreenBody />
    </PaletteScope>
  );
}

function RegisterScreenBody() {
  const { signUp, isMockAuth } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [birth, setBirth] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    // Domaine réservé aux comptes Snapchat : refusé avant tout appel réseau.
    if (isReservedSignupEmail(email)) {
      Alert.alert(t('common.error'), t('safety.reservedEmail'));
      return;
    }
    // 020 : date de naissance obligatoire, âge minimum vérifié avant la
    // création du compte (le serveur revérifie à l'enregistrement).
    const birthCheck = checkBirthDate(birth);
    if (!birthCheck.ok) {
      Alert.alert(t('common.error'), t(birthDateCheckErrorKey(birthCheck.reason)));
      return;
    }
    if (!isOldEnoughToSignUp(birthCheck.age) || (await isAgeRefused())) {
      void markAgeRefused();
      Alert.alert(t('age.tooYoungTitle'), t('age.tooYoungBody', { age: MIN_SIGNUP_AGE }));
      return;
    }
    setLoading(true);
    try {
      // 018 : un pseudo contenant un terme de la liste est refusé (sinon le
      // serveur le remplacerait par « createur_… » à l'inscription).
      if ((await checkText(username, 'username')) === 'refused') {
        Alert.alert(t('common.error'), t('textFilter.usernameRefused'));
        return;
      }
      const signupEmail = email || 'nouveau@nia.app';
      // Envoyée à la première session (après confirmation de l'e-mail si
      // besoin) par AgeContext ; jamais affichée sur le profil.
      await savePendingBirthDate(signupEmail, birthCheck.iso);
      await signUp(signupEmail, password || 'nia', username);
      router.replace('/(tabs)');
    } catch (e) {
      const msg = isTextRefusedError(e)
        ? t('textFilter.usernameRefused')
        : e instanceof Error
          ? e.message
          : t('auth.registerFail');
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View
        style={[
          styles.badgeWrap,
          { backgroundColor: isMockAuth ? Colors.terre : Colors.vert },
        ]}
      >
        <Text style={styles.badge}>
          {isMockAuth ? t('auth.authMockBadge') : t('auth.authSupabaseBadge')}
        </Text>
      </View>
      <Text style={styles.hint}>
        {isMockAuth
          ? t('auth.mockRegisterHint')
          : t('auth.supabaseRegisterHint')}
      </Text>

      <Text style={styles.label}>{t('common.username')}</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
        placeholder={t('auth.usernamePlaceholder')}
        placeholderTextColor={Colors.textMuted}
      />

      <Text style={styles.label}>{t('common.email')}</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.emailPlaceholder')}
        placeholderTextColor={Colors.textMuted}
      />

      <Text style={styles.label}>{t('common.password')}</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={Colors.textMuted}
      />

      <BirthDateInput value={birth} onChange={setBirth} editable={!loading} />
      <Text style={styles.birthHint}>{t('age.birthDateHint')}</Text>

      <Button
        title={t('auth.createAccount')}
        variant="filled"
        loading={loading}
        onPress={onSubmit}
        style={{ marginTop: Spacing.lg }}
      />
      <GoogleSignInButton />
      <SnapchatSignInButton />

      {/*
        Les deux textes que l'utilisateur accepte doivent etre lisibles avant
        la creation du compte, pas seulement apres. Snap comme Google exigent
        que les CGU soient atteignables ; les afficher ici est le seul endroit
        ou la personne les voit au moment ou elle s'engage.
      */}
      <Text style={styles.legalNotice}>{t('auth.legalAccept')}</Text>
      <View style={styles.legalRow}>
        <Pressable
          onPress={() => {
            void WebBrowser.openBrowserAsync(termsOfServiceUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('profile.terms')}
          style={styles.legalBtn}
        >
          <Text style={styles.legalLink}>{t('profile.terms')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void WebBrowser.openBrowserAsync(privacyPolicyUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('profile.privacyPolicy')}
          style={styles.legalBtn}
        >
          <Text style={styles.legalLink}>{t('profile.privacyPolicy')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void WebBrowser.openBrowserAsync(communityGuidelinesUrl(locale));
          }}
          accessibilityRole="link"
          accessibilityLabel={t('safety.communityRules')}
          style={styles.legalBtn}
        >
          <Text style={styles.legalLink}>{t('safety.communityRules')}</Text>
        </Pressable>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.noir,
    padding: Spacing.lg,
  },
  badgeWrap: {
    alignSelf: 'flex-start',
    borderRadius: Radii.sm,
    marginBottom: Spacing.md,
  },
  badge: {
    color: Colors.sable,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontFamily: Fonts.bold,
    fontSize: 11,
  },
  birthHint: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  hint: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.xl,
  },
  label: {
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
    marginBottom: 6,
  },
  legalNotice: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  legalLink: {
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  input: {
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: Spacing.md,
  },
});

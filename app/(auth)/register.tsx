import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { checkText, isTextRefusedError } from '@/lib/textFilter';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { SnapchatSignInButton } from '@/components/SnapchatSignInButton';

export default function RegisterScreen() {
  const { signUp, isMockAuth } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    // Domaine réservé aux comptes Snapchat : refusé avant tout appel réseau.
    if (isReservedSignupEmail(email)) {
      Alert.alert(t('common.error'), t('safety.reservedEmail'));
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
      await signUp(email || 'nouveau@nia.app', password || 'nia', username);
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

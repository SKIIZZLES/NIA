import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { SnapchatSignInButton } from '@/components/SnapchatSignInButton';

export default function LoginScreen() {
  const { signIn, isMockAuth } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState(isMockAuth ? 'demo@nia.app' : '');
  const [password, setPassword] = useState(isMockAuth ? 'nia123' : '');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('auth.loginFail');
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
        {isMockAuth ? t('auth.mockLoginHint') : t('auth.supabaseLoginHint')}
      </Text>

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
        title={t('auth.signIn')}
        variant="filled"
        loading={loading}
        onPress={onSubmit}
        style={{ marginTop: Spacing.lg }}
      />
      <GoogleSignInButton />
      <SnapchatSignInButton />
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

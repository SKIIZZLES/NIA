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
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function LoginScreen() {
  const { signIn, isMockAuth } = useAuth();
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
      const msg = e instanceof Error ? e.message : 'Connexion impossible';
      Alert.alert('Erreur', msg);
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
          {isMockAuth ? 'AUTH MOCK MVP' : 'AUTH SUPABASE'}
        </Text>
      </View>
      <Text style={styles.hint}>
        {isMockAuth
          ? 'Accepte n’importe quel email / mot de passe. Session stockée localement (AsyncStorage). Remplissez EXPO_PUBLIC_SUPABASE_* dans .env pour activer Supabase.'
          : 'Connexion email / mot de passe via Supabase Auth. Créez un compte sur l’écran Inscription.'}
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="vous@email.com"
        placeholderTextColor={Colors.textMuted}
      />

      <Text style={styles.label}>Mot de passe</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={Colors.textMuted}
      />

      <Button
        title="Se connecter"
        variant="filled"
        loading={loading}
        onPress={onSubmit}
        style={{ marginTop: Spacing.lg }}
      />
      <GoogleSignInButton />
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

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useAuth } from '@/context/AuthContext';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

export default function EditProfileScreen() {
  const { user, updateProfile } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!user) {
      Alert.alert('Connexion requise', 'Connectez-vous pour modifier le profil.');
      return;
    }
    setBusy(true);
    try {
      await updateProfile({ displayName, bio });
      Alert.alert('Enregistré', 'Votre profil a été mis à jour.');
      router.back();
    } catch (e) {
      Alert.alert(
        'Erreur',
        e instanceof Error ? e.message : 'Impossible d’enregistrer',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={Colors.sable} />
        </Pressable>
        <Text style={styles.topTitle}>Modifier le profil</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Nom affiché</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Votre nom"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, styles.bio]}
          value={bio}
          onChangeText={setBio}
          placeholder="Parlez de votre univers créatif…"
          placeholderTextColor={Colors.textMuted}
          multiline
        />

        <Text style={styles.hint}>
          @{user?.username || '…'} — le handle ne peut pas être modifié ici.
        </Text>

        <Button
          title="Enregistrer"
          variant="gold"
          loading={busy}
          onPress={save}
          style={{ marginTop: Spacing.lg }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.noir },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 16,
  },
  form: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  label: {
    marginTop: Spacing.md,
    marginBottom: 6,
    color: Colors.sable,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  input: {
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 15,
    padding: 14,
  },
  bio: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  hint: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
  },
});

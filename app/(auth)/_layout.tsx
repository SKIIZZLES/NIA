import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.noir },
        headerTintColor: Colors.sable,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
        contentStyle: { backgroundColor: Colors.noir },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="login" options={{ title: 'Se connecter' }} />
      <Stack.Screen name="register" options={{ title: 'Créer un compte' }} />
    </Stack>
  );
}

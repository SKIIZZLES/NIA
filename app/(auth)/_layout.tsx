import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useI18n } from '@/context/I18nContext';

export default function AuthLayout() {
  const { t } = useI18n();

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
      <Stack.Screen name="login" options={{ title: t('auth.loginTitle') }} />
      <Stack.Screen
        name="register"
        options={{ title: t('auth.registerTitle') }}
      />
    </Stack>
  );
}

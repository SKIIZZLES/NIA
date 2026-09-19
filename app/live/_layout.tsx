import { Stack } from 'expo-router';
import { useColors } from '@/context/ThemeContext';

export default function LiveLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.noir },
        animation: 'fade',
      }}
    />
  );
}

/**
 * Parcours de publication, hors de la barre d'onglets.
 *
 * Le CreateProvider est monté ici : il couvre les trois étapes et meurt avec
 * la pile. Sortir du parcours jette donc le brouillon, sans reset explicite.
 */
import React from 'react';
import { Stack } from 'expo-router';
import { CreateProvider } from '@/context/CreateContext';
import { useColors } from '@/context/ThemeContext';

export default function CreateLayout() {
  const colors = useColors();

  return (
    <CreateProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.noir },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="camera" />
        <Stack.Screen name="preview" />
        <Stack.Screen name="publish" />
      </Stack>
    </CreateProvider>
  );
}

/**
 * Parcours de publication, hors de la barre d'onglets.
 *
 * Le CreateProvider est monté ici : il couvre les trois étapes et meurt avec
 * la pile. Sortir du parcours jette donc l'état en mémoire, sans reset
 * explicite ; les brouillons enregistrés (S6) vivent, eux, sur le disque.
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
        <Stack.Screen name="edit" />
        <Stack.Screen name="preview" />
        <Stack.Screen name="publish" />
        <Stack.Screen name="drafts" />
      </Stack>
    </CreateProvider>
  );
}

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

/**
 * EMERGENCY minimal root — no fonts, AuthProvider, FeedProvider, supabase,
 * SplashScreen.preventAutoHideAsync, or expo-av. First paint must stay open.
 */
export default function RootLayout() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>NIA</Text>
      <Text style={styles.subtitle}>ça marche</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#D4AF37',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 4,
  },
  subtitle: {
    color: '#F5F0E8',
    fontSize: 18,
    marginTop: 12,
  },
});

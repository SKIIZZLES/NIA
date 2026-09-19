import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { AuthProvider } from '@/context/AuthContext';
import { FeedProvider } from '@/context/FeedContext';
import { I18nProvider } from '@/context/I18nContext';
import { ThemeProvider, useColors } from '@/context/ThemeContext';
import { Colors } from '@/constants/theme';
import { t } from '@/lib/i18n';

(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ??= Buffer;

SplashScreen.preventAutoHideAsync().catch(() => {});

type EBProps = { children: ReactNode };
type EBState = { error: Error | null };

/** Catch JS render errors so the APK shows a screen instead of exiting silently. */
class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: Colors.noir,
            padding: 24,
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: Colors.or,
              fontSize: 18,
              fontWeight: '700',
              marginBottom: 12,
            }}
          >
            {t('errors.boundaryTitle')}
          </Text>
          <ScrollView style={{ maxHeight: 240 }}>
            <Text style={{ color: '#ccc', fontSize: 13 }}>
              {this.state.error.message}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootNavigator() {
  const colors = useColors();

  return (
    <>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.noir },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="user/[username]" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="appearance" options={{ headerShown: false }} />
        <Stack.Screen name="sound/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="events" options={{ headerShown: false }} />
        <Stack.Screen name="series" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="live" options={{ headerShown: false }} />
        <Stack.Screen name="video/[id]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

const FONT_TIMEOUT_MS = 3000;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_300Light,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
  });
  const [fontTimedOut, setFontTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontTimedOut) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontTimedOut]);

  // Do not block forever on font download failure — continue with system fonts.
  if (!fontsLoaded && !fontTimedOut) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.noir,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={Colors.or} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <FeedProvider>
              <RootNavigator />
            </FeedProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

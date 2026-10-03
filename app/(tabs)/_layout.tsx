import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts, Radii, TAB_BAR_BASE_HEIGHT } from '@/constants/theme';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';

export default function TabsLayout() {
  const { t } = useI18n();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        tabBar: {
          backgroundColor: colors.noir,
          // Filet ocre discret : signature NIA en haut de la barre
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Respecte la barre système (iPhone récents, Android gestuel)
          height: TAB_BAR_BASE_HEIGHT + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        label: {
          fontFamily: Fonts.medium,
          fontSize: 10,
        },
        createBtn: {
          width: 46,
          height: 44,
          borderRadius: Radii.create,
          backgroundColor: colors.or,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.orSoft,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.sable,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: t('tabs.discover'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tabs.create'),
          tabBarAccessibilityLabel: t('tabs.create'),
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View style={styles.createBtn}>
              <Ionicons name="add" size={28} color={colors.onAccent} />
            </View>
          ),
        }}
        // Le « + » ouvre le parcours de publication plein écran plutôt que de
        // sélectionner un onglet : la barre d'onglets n'a pas à rester visible
        // pendant qu'on publie. Premier écran : la caméra NIA, comme sur TikTok.
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/create/camera');
          },
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('tabs.notifications'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

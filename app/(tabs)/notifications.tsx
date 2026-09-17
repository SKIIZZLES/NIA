import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

const UPCOMING = [
  'Likes & commentaires sur vos vidéos',
  'Nouveaux abonnés',
  'Mentions & collaborations',
  'Alertes de modération (signalements)',
];

export default function NotificationsScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>
        Activité autour de votre profil et de vos publications.
      </Text>

      <View style={styles.emptyCard}>
        <View style={styles.iconRing}>
          <Ionicons name="notifications-outline" size={36} color={Colors.or} />
        </View>
        <Text style={styles.emptyTitle}>Rien pour l’instant</Text>
        <Text style={styles.emptyBody}>
          Quand la communauté interagit avec vos contenus, tout apparaîtra ici —
          clairement, sans bruit inutile.
        </Text>
      </View>

      <Text style={styles.section}>Bientôt</Text>
      <View style={styles.list}>
        {UPCOMING.map((item) => (
          <View key={item} style={styles.row}>
            <View style={styles.dot} />
            <Text style={styles.rowText}>{item}</Text>
          </View>
        ))}
      </View>

      <View style={styles.note}>
        <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
        <Text style={styles.noteText}>
          Messagerie privée reportée en phase 2. Focus Sprint 1 : feed, publication,
          engagement social.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.noir, paddingHorizontal: Spacing.lg },
  title: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 28,
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginTop: 6,
    marginBottom: Spacing.lg,
    lineHeight: 18,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.lg,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.4)',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 18,
  },
  emptyBody: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  section: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    color: Colors.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  list: {
    borderRadius: Radii.md,
    backgroundColor: Colors.noirElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.or,
  },
  rowText: {
    flex: 1,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 14,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: Colors.noirSoft,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteText: {
    flex: 1,
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});

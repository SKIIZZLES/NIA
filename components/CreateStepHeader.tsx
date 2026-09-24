/**
 * En-tête commun aux trois étapes de app/create/*.
 *
 * Existe pour que le compteur d'étapes et le bouton retour ne soient pas
 * recopiés trois fois. La flèche appelle router.back() : à l'étape 1 elle
 * quitte le parcours, ailleurs elle remonte d'une étape.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Spacing } from '@/constants/theme';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';

export const CREATE_STEP_COUNT = 3;

type Props = {
  /** Rang de l'étape, de 1 à CREATE_STEP_COUNT. */
  step: number;
  title: string;
};

export function CreateStepHeader({ step, title }: Props) {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.xs,
          marginTop: Spacing.sm,
        },
        title: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 26,
          flex: 1,
        },
        step: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
          letterSpacing: 0.3,
          marginBottom: Spacing.md,
        },
      }),
    [colors],
  );

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={() =>
            // Ouvert par lien profond à froid, il n'y a rien à dépiler :
            // on retombe sur le fil plutôt que de laisser l'écran bloqué.
            router.canGoBack() ? router.back() : router.replace('/(tabs)')
          }
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.sable} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.step}>
        {t('create.stepOf', { n: step, total: CREATE_STEP_COUNT })}
      </Text>
    </View>
  );
}

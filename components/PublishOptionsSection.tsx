/**
 * Options de publication (sprint S5, colonnes de la migration 016) :
 * visibilité, commentaires, republication, label IA, texte alternatif, lieu.
 *
 * `supported === false` : la base n'a pas encore 016. Les options restent
 * visibles mais verrouillées sur les valeurs d'avant (public, commentaires et
 * republication autorisés) avec une note : rien n'est promis qui ne serait
 * pas enregistré.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/context/ThemeContext';
import { useI18n } from '@/context/I18nContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  MAX_ALT_TEXT,
  MAX_LOCATION_TEXT,
  type PublishOptions,
} from '@/lib/publishOptions';
import type { VideoVisibility } from '@/types/database';

type Props = {
  value: PublishOptions;
  onChange: (patch: Partial<PublishOptions>) => void;
  /** null : vérification en cours ; false : 016 absente. */
  supported: boolean | null;
  disabled?: boolean;
  isVideo: boolean;
};

const VISIBILITY: { id: VideoVisibility; icon: React.ComponentProps<typeof Ionicons>['name']; key: string; hint: string }[] = [
  { id: 'public', icon: 'earth-outline', key: 'create.visibilityPublic', hint: 'create.visibilityPublicHint' },
  { id: 'followers', icon: 'people-outline', key: 'create.visibilityFollowers', hint: 'create.visibilityFollowersHint' },
  { id: 'private', icon: 'lock-closed-outline', key: 'create.visibilityPrivate', hint: 'create.visibilityPrivateHint' },
];

export function PublishOptionsSection({ value, onChange, supported, disabled = false, isVideo }: Props) {
  const colors = useColors();
  const { t } = useI18n();
  const locked = disabled || supported === false;
  const reuseLocked = locked || value.visibility !== 'public';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        label: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14, marginTop: Spacing.md },
        hint: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
        note: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          marginTop: Spacing.sm,
          padding: Spacing.sm,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
        },
        seg: { flexDirection: 'row', gap: 8, marginTop: Spacing.sm },
        segItem: {
          flex: 1,
          alignItems: 'center',
          gap: 4,
          paddingVertical: 10,
          paddingHorizontal: 4,
          borderRadius: Radii.md,
          borderWidth: 1,
        },
        segText: { fontFamily: Fonts.medium, fontSize: 12, textAlign: 'center' },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        rowTexts: { flex: 1 },
        rowTitle: { color: colors.sable, fontFamily: Fonts.medium, fontSize: 14 },
        input: {
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 14,
          paddingHorizontal: Spacing.md,
          paddingVertical: 10,
          marginTop: Spacing.sm,
        },
        counter: { color: colors.textMuted, fontFamily: Fonts.regular, fontSize: 11, textAlign: 'right', marginTop: 2 },
      }),
    [colors],
  );

  const toggle = (
    title: string,
    hint: string,
    on: boolean,
    set: (v: boolean) => void,
    isLocked: boolean,
    icon: React.ComponentProps<typeof Ionicons>['name'],
  ) => (
    <View style={[styles.row, isLocked && { opacity: 0.75 }]}>
      <Ionicons name={icon} size={20} color={colors.or} />
      <View style={styles.rowTexts}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={on}
        onValueChange={set}
        disabled={isLocked}
        trackColor={{ false: colors.noirSoft, true: colors.or }}
        thumbColor={colors.sable}
        accessibilityLabel={title}
      />
    </View>
  );

  const current = VISIBILITY.find((v) => v.id === value.visibility) ?? VISIBILITY[0];

  return (
    <View>
      <Text style={styles.label}>{t('create.visibilityLabel')}</Text>
      <View style={styles.seg}>
        {VISIBILITY.map((v) => {
          const on = value.visibility === v.id;
          const isLocked = locked && v.id !== 'public';
          return (
            <Pressable
              key={v.id}
              onPress={() => onChange({ visibility: v.id })}
              disabled={isLocked}
              style={[
                styles.segItem,
                {
                  borderColor: on ? colors.or : colors.border,
                  backgroundColor: on ? colors.or + '1A' : colors.noirSoft,
                  opacity: isLocked ? 0.7 : 1,
                },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: isLocked }}
            >
              <Ionicons name={v.icon} size={20} color={on ? colors.or : colors.textSecondary} />
              <Text style={[styles.segText, { color: on ? colors.sable : colors.textSecondary }]}>
                {t(v.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t(current.hint)}</Text>

      {toggle(
        t('create.allowComments'),
        t('create.allowCommentsHint'),
        value.allowComments,
        (v) => onChange({ allowComments: v }),
        locked,
        'chatbubble-ellipses-outline',
      )}
      {toggle(
        t('create.allowReuse'),
        value.visibility === 'public' ? t('create.allowReuseHint') : t('create.allowReuseOnlyPublic'),
        value.visibility === 'public' && value.allowReuse,
        (v) => onChange({ allowReuse: v }),
        reuseLocked,
        'repeat-outline',
      )}
      {toggle(
        t('create.aiLabel'),
        t('create.aiLabelHint'),
        value.aiGenerated,
        (v) => onChange({ aiGenerated: v }),
        locked,
        'sparkles-outline',
      )}

      <Text style={styles.label}>{t('create.altTextLabel')}</Text>
      <Text style={styles.hint}>
        {isVideo ? t('create.altTextHintVideo') : t('create.altTextHintPhoto')}
      </Text>
      <TextInput
        style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }, locked && { opacity: 0.75 }]}
        value={value.altText}
        onChangeText={(v) => onChange({ altText: v })}
        editable={!locked}
        multiline
        maxLength={MAX_ALT_TEXT}
        placeholder={t('create.altTextPlaceholder')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('create.altTextLabel')}
      />
      <Text style={styles.counter}>{`${value.altText.length}/${MAX_ALT_TEXT}`}</Text>

      <Text style={styles.label}>{t('create.locationLabel')}</Text>
      <TextInput
        style={[styles.input, locked && { opacity: 0.75 }]}
        value={value.locationText}
        onChangeText={(v) => onChange({ locationText: v })}
        editable={!locked}
        maxLength={MAX_LOCATION_TEXT}
        placeholder={t('create.locationPlaceholder')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('create.locationLabel')}
      />
      <Text style={styles.hint}>{t('create.locationHint')}</Text>

      {supported === false ? <Text style={styles.note}>{t('create.optionsNeedServer')}</Text> : null}
    </View>
  );
}

/**
 * Étape 3 — la publication : son, légende (suggestions #/@), hashtags,
 * catégorie, options de publication (S5, migration 016) et envoi des
 * réglages d'édition (edit_meta).
 *
 * Le choix du son garde son état localement (modale, import en cours) : c'est
 * de l'état d'interface, pas du brouillon. Seul le son retenu remonte dans le
 * CreateContext.
 *
 * Sprint S6 : « Brouillon » enregistre la création sur le téléphone ; une
 * publication réussie depuis un brouillon supprime ce brouillon et ses
 * fichiers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { CreateStepHeader } from '@/components/CreateStepHeader';
import { SoundTrimControl } from '@/components/SoundTrimControl';
import { MentionSuggestions } from '@/components/MentionSuggestions';
import { PublishOptionsSection } from '@/components/PublishOptionsSection';
import { useAuth } from '@/context/AuthContext';
import { useCreateDraft } from '@/context/CreateContext';
import { useFeed } from '@/context/FeedContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { DISCOVER_CATEGORIES } from '@/constants/categories';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_DURATION_SEC } from '@/constants/publish';
import { listSoundsByUser, type SoundItem } from '@/lib/sounds';
import { importSoundFromDevice } from '@/lib/soundImport';
import { applyMention, DEFAULT_PUBLISH_OPTIONS } from '@/lib/publishOptions';
import { probePublishOptionsSupport } from '@/lib/videos';
import { deleteDraft, isDraftStorageAvailable } from '@/lib/drafts';
import { useBlockBackWhile } from '@/hooks/useBlockBackWhile';

export default function CreatePublishStep() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const { user } = useAuth();
  const { publishPost, isMockFeed } = useFeed();
  const {
    mode,
    media,
    cover,
    caption,
    setCaption,
    category,
    setCategory,
    sound,
    setSound,
    soundOffsetMs,
    setSoundOffsetMs,
    filter,
    hashtags,
    uploadId,
    maxMb,
    maxMinutes,
    publishOptions,
    setPublishOptions,
    buildPublishEditMeta,
    draftId,
    saveDraft,
    releaseLeaveGuard,
  } = useCreateDraft();
  const draftsAvailable = isDraftStorageAvailable();
  const [savingDraft, setSavingDraft] = useState(false);
  /** Publication terminée : on quitte le parcours après le rendu suivant. */
  const [published, setPublished] = useState(false);

  // La garde de sortie de l'éditeur est levée dans le même rendu : la sortie
  // du parcours ne déclenche donc pas « Enregistrer le brouillon ? ».
  useEffect(() => {
    if (!published) return;
    Alert.alert(
      isMockFeed ? t('create.publishedMockTitle') : t('create.publishedTitle'),
      isMockFeed ? t('create.publishedMockBody') : t('create.publishedBody'),
    );
    router.replace('/(tabs)');
  }, [published, isMockFeed, router, t]);

  const onSaveDraft = async () => {
    if (savingDraft || busy) return;
    setSavingDraft(true);
    try {
      await saveDraft();
      Alert.alert(t('drafts.savedTitle'), t('drafts.savedBody'));
    } catch {
      Alert.alert(t('common.error'), t('drafts.saveFailed'));
    } finally {
      setSavingDraft(false);
    }
  };

  // 016 appliquée ? En mode démo, les options restent locales : toujours oui.
  const [optionsSupported, setOptionsSupported] = useState<boolean | null>(
    isMockFeed ? true : null,
  );
  useEffect(() => {
    if (isMockFeed) return;
    let alive = true;
    void probePublishOptionsSupport().then((ok) => {
      if (!alive) return;
      setOptionsSupported(ok);
      // 016 absente : on revient aux réglages que le serveur sait honorer.
      if (!ok) setPublishOptions(DEFAULT_PUBLISH_OPTIONS);
    });
    return () => {
      alive = false;
    };
  }, [isMockFeed, setPublishOptions]);

  // Curseur de la légende (suggestions #/@) ; `forcedSelection` ne sert
  // qu'une fois, juste après l'insertion d'une suggestion.
  const [captionCursor, setCaptionCursor] = useState(caption.length);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();

  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  // S7 : le retour Android ne quitte plus l'écran pendant l'envoi (annuler
  // d'abord) ni pendant l'enregistrement du brouillon.
  useBlockBackWhile(busy || savingDraft);
  /** Ratio réel d'envoi (0 → 1), null tant qu'aucun octet n'est parti. */
  const [progress, setProgress] = useState<number | null>(null);
  const [progressStage, setProgressStage] = useState<'media' | 'cover'>('media');
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** > 0 signifie « réessai » : l'objet Storage est alors écrasé. */
  const [attempts, setAttempts] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [ownSounds, setOwnSounds] = useState<SoundItem[]>([]);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [newSoundTitle, setNewSoundTitle] = useState('');

  const loadOwnSounds = useCallback(async () => {
    if (!user?.id || user.id.startsWith('mock_') || isMockFeed) {
      setOwnSounds([]);
      return;
    }
    try {
      setOwnSounds(await listSoundsByUser(user.id));
    } catch {
      setOwnSounds([]);
    }
  }, [user?.id, isMockFeed]);

  useEffect(() => {
    void loadOwnSounds();
  }, [loadOwnSounds]);

  const pickAudioFile = async () => {
    if (!user?.id) {
      Alert.alert(t('feed.loginRequiredTitle'), t('sound.loginRequired'));
      return;
    }
    try {
      // Logique partagée avec la feuille son de la caméra (lib/soundImport).
      const created = await importSoundFromDevice({
        user,
        isMockFeed,
        title: newSoundTitle,
        defaultTitle: t('sound.defaultTitle'),
        onUploadStart: () => setSoundBusy(true),
      });
      if (!created) return;
      setSound(created);
      setOwnSounds((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setSoundPickerOpen(false);
      setNewSoundTitle('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('sound.uploadFail');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSoundBusy(false);
    }
  };

  const publish = async () => {
    if (savingDraft) return;
    if (!media?.uri && !isMockFeed) {
      Alert.alert(t('create.alertMediaRequired'), t('create.errNoMedia'));
      return;
    }
    if (media?.fileSize != null && media.fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert(
        t('create.alertTooLarge'),
        t('create.errTooLarge', { mb: maxMb }),
      );
      return;
    }
    if (
      media?.type === 'video' &&
      media.durationMs != null &&
      media.durationMs > MAX_VIDEO_DURATION_SEC * 1000
    ) {
      Alert.alert(
        t('create.alertTooLong'),
        t('create.errTooLong', { minutes: maxMinutes }),
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setUploadError(null);
    setProgress(null);
    setProgressStage('media');
    try {
      await publishPost({
        caption,
        localUri: media?.uri || undefined,
        mimeType: media?.mimeType ?? null,
        fileName: media?.fileName ?? null,
        mediaKind: media?.type ?? (mode === 'photo' ? 'image' : 'video'),
        coverUri: media?.type === 'video' ? cover?.uri ?? null : null,
        coverMimeType: media?.type === 'video' ? cover?.mimeType ?? null : null,
        coverFileName: media?.type === 'video' ? cover?.fileName ?? null : null,
        category: category ?? undefined,
        hashtags,
        fileSize: media?.fileSize ?? undefined,
        durationMs: media?.durationMs ?? undefined,
        soundId: sound?.id ?? null,
        soundUrl: sound?.publicUrl ?? null,
        soundTitle: sound?.title ?? null,
        filterId: filter?.id ?? null,
        // 016 absente : pas d'options (publication comme avant) ; edit_meta
        // est tenté puis retiré sans bruit par la publication.
        publishOptions: optionsSupported === false ? undefined : publishOptions,
        editMeta: buildPublishEditMeta(),
        uploadId,
        // Dès la deuxième tentative on écrase l'objet éventuellement partiel
        // laissé par la précédente, au lieu d'échouer sur « already exists ».
        overwrite: attempts > 0,
        onProgress: (stage, p) => {
          setProgressStage(stage);
          setProgress(p.ratio);
        },
        signal: controller.signal,
      });
      // Publié depuis un brouillon local : il a rempli son rôle (S6). Un échec
      // de suppression n'annule pas la publication ; le brouillon reste listé.
      if (draftId) {
        try {
          await deleteDraft(draftId);
        } catch {
          // sans conséquence pour la publication
        }
      }
      // Pas de reset ici : quitter /create démonte le CreateProvider, donc le
      // brouillon. Le vider avant de naviguer ferait passer cet écran par son
      // garde Redirect vers l'étape 1, en course avec le replace.
      releaseLeaveGuard();
      setPublished(true);
    } catch (e) {
      const aborted =
        controller.signal.aborted ||
        (e instanceof Error && e.name === 'AbortError');
      setAttempts((n) => n + 1);
      if (aborted) {
        // Annulation volontaire : ce n'est pas une erreur à dramatiser.
        setUploadError(t('create.uploadCanceled'));
      } else {
        const msg = e instanceof Error && e.message ? e.message : t('create.publishFail');
        setUploadError(msg);
      }
      // Pas d'Alert : le message reste à l'écran à côté du bouton Réessayer,
      // et le brouillon est intact — ni le média ni la légende ne sont perdus.
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: colors.noir },
        scroll: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xxl,
        },
        label: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 14,
          marginTop: Spacing.md,
        },
        hint: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 12,
          lineHeight: 17,
          marginTop: 2,
        },
        input: {
          minHeight: 96,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          color: colors.sable,
          fontFamily: Fonts.regular,
          fontSize: 15,
          padding: Spacing.md,
          marginTop: Spacing.sm,
          textAlignVertical: 'top',
        },
        tagRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: Spacing.sm,
        },
        tagChip: {
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.or,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        tagText: {
          color: colors.or,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        catRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: Spacing.sm,
        },
        catChip: {
          borderRadius: Radii.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          paddingHorizontal: Spacing.md,
          paddingVertical: 8,
        },
        catChipOn: {
          borderColor: colors.or,
          backgroundColor: colors.or + '1A',
        },
        catText: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 13,
        },
        catTextOn: { color: colors.sable },
        progressBlock: { marginTop: Spacing.xl },
        actionsRow: { flexDirection: 'row', gap: Spacing.sm },
        actionDraft: { flex: 1 },
        actionPublish: { flex: 2 },
        progressTrack: {
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.noirSoft,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          overflow: 'hidden',
        },
        progressFill: {
          height: '100%',
          backgroundColor: colors.or,
        },
        progressRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: Spacing.xs,
        },
        progressLabel: {
          color: colors.textSecondary,
          fontFamily: Fonts.medium,
          fontSize: 12,
        },
        errorText: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 13,
          lineHeight: 18,
          marginTop: Spacing.md,
        },
        soundSelected: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.noirSoft,
          padding: Spacing.md,
          marginTop: Spacing.sm,
        },
        soundSelectedText: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 14,
        },
        soundSelectedMeta: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
        },
        modalBackdrop: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'flex-end',
        },
        modalSheet: {
          backgroundColor: colors.noirElevated,
          borderTopLeftRadius: Radii.lg,
          borderTopRightRadius: Radii.lg,
          padding: Spacing.lg,
          maxHeight: '75%',
          borderTopWidth: 1,
          borderColor: colors.border,
        },
        modalTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 18,
          marginBottom: Spacing.sm,
        },
        soundRowItem: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        soundRowTitle: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 14,
          flex: 1,
        },
        soundRowMeta: {
          color: colors.textMuted,
          fontFamily: Fonts.regular,
          fontSize: 11,
        },
      }),
    [colors],
  );

  // Le mode démo autorise une publication sans média ; le mode réel non.
  if (!media?.uri && !isMockFeed) {
    return <Redirect href="/create" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          // Au-dessus de la barre de navigation Android (bord à bord).
          { paddingBottom: Spacing.xxl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CreateStepHeader
          step={3}
          title={t('create.stepPublishTitle')}
          disabled={busy || savingDraft}
        />

        <Text style={styles.hint}>
          {isMockFeed ? t('create.subtitleMock') : t('create.subtitleSupabase')}
        </Text>

        <Text style={styles.label}>{t('create.addSound')}</Text>
        <Text style={styles.hint}>{t('create.addSoundHint')}</Text>
        {sound ? (
          <>
          <View style={styles.soundSelected}>
            <Ionicons name="musical-notes" size={22} color={colors.or} />
            <View style={{ flex: 1 }}>
              <Text style={styles.soundSelectedText} numberOfLines={1}>
                {sound.title}
              </Text>
              <Text style={styles.soundSelectedMeta}>{sound.handle}</Text>
            </View>
            <Pressable
              onPress={() => setSound(null)}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          {/* Sprint S2 : écoute + début du son (réglage local au brouillon). */}
          <SoundTrimControl
            sound={sound}
            offsetMs={soundOffsetMs}
            onChangeOffset={setSoundOffsetMs}
            paused={busy}
          />
          </>
        ) : (
          <Button
            title={t('create.pickSound')}
            variant="outline"
            onPress={() => {
              void loadOwnSounds();
              setSoundPickerOpen(true);
            }}
            style={{ marginTop: Spacing.sm }}
          />
        )}

        <Text style={styles.label}>{t('create.captionLabel')}</Text>
        <TextInput
          style={styles.input}
          multiline
          value={caption}
          onChangeText={(v) => {
            setCaption(v);
            setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          onSelectionChange={(e) => {
            setCaptionCursor(e.nativeEvent.selection.end);
            if (forcedSelection) setForcedSelection(undefined);
          }}
          placeholder={t('create.captionPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />
        <MentionSuggestions
          text={caption}
          cursor={Math.min(captionCursor, caption.length)}
          enabled={!busy && !isMockFeed}
          onPick={(token, value) => {
            const next = applyMention(caption, token, value);
            setCaption(next.text);
            setCaptionCursor(next.cursor);
            setForcedSelection({ start: next.cursor, end: next.cursor });
          }}
        />
        {hashtags.length > 0 ? (
          <View style={styles.tagRow}>
            {hashtags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>{t('create.hashtagHint')}</Text>
        )}

        <Text style={styles.label}>{t('create.categoryLabel')}</Text>
        <View style={styles.catRow}>
          {DISCOVER_CATEGORIES.map((c) => {
            const selected = category === c.id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCategory(selected ? null : c.id)}
                style={[styles.catChip, selected && styles.catChipOn]}
              >
                <Text style={[styles.catText, selected && styles.catTextOn]}>
                  {t(c.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <PublishOptionsSection
          value={publishOptions}
          onChange={setPublishOptions}
          supported={optionsSupported}
          disabled={busy}
          isVideo={media?.type === 'video'}
        />

        {busy ? (
          <View style={styles.progressBlock}>
            {/* Barre pilotée par les octets réellement partis (bytesSent /
                totalBytes remontés par okhttp ou URLSession). Quand la taille
                totale est inconnue, on n'affiche pas de pourcentage inventé :
                la barre reste vide et seul le libellé bouge. */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round((progress ?? 0) * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>
                {progressStage === 'cover'
                  ? t('create.uploadingCover')
                  : t('create.uploading')}
              </Text>
              <Text style={styles.progressLabel}>
                {progress == null ? '' : `${Math.round(progress * 100)} %`}
              </Text>
            </View>
            <Button
              title={t('common.cancel')}
              variant="outline"
              onPress={() => abortRef.current?.abort()}
              style={{ marginTop: Spacing.md }}
            />
          </View>
        ) : (
          <>
            {uploadError ? (
              <Text style={styles.errorText}>{uploadError}</Text>
            ) : null}
            <View
              style={[styles.actionsRow, { marginTop: uploadError ? Spacing.md : Spacing.xl }]}
            >
              {draftsAvailable && media?.uri ? (
                <Button
                  title={t('drafts.save')}
                  variant="outline"
                  loading={savingDraft}
                  disabled={savingDraft || published}
                  onPress={() => void onSaveDraft()}
                  style={styles.actionDraft}
                />
              ) : null}
              <Button
                title={uploadError ? t('create.retry') : t('create.publish')}
                variant="gold"
                disabled={savingDraft || published}
                onPress={() => void publish()}
                style={styles.actionPublish}
              />
            </View>
          </>
        )}

        <Modal
          visible={soundPickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setSoundPickerOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setSoundPickerOpen(false)}
          >
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{t('create.pickSound')}</Text>
              <Text style={styles.hint}>{t('sound.originalOnly')}</Text>
              <Text style={styles.label}>{t('sound.uploadTitleLabel')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 44, marginBottom: 8 }]}
                value={newSoundTitle}
                onChangeText={setNewSoundTitle}
                placeholder={t('sound.uploadTitlePlaceholder')}
                placeholderTextColor={colors.textMuted}
              />
              <Button
                title={t('sound.uploadAudio')}
                variant="gold"
                loading={soundBusy}
                onPress={() => void pickAudioFile()}
              />
              <Text style={[styles.label, { marginTop: Spacing.md }]}>
                {t('sound.mySounds')}
              </Text>
              <ScrollView style={{ maxHeight: 220 }}>
                {ownSounds.length === 0 ? (
                  <Text style={styles.hint}>{t('sound.emptyOwn')}</Text>
                ) : (
                  ownSounds.map((s) => (
                    <Pressable
                      key={s.id}
                      style={styles.soundRowItem}
                      onPress={() => {
                        setSound(s);
                        setSoundPickerOpen(false);
                      }}
                    >
                      <Ionicons name="musical-notes" size={20} color={colors.or} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.soundRowTitle}>{s.title}</Text>
                        <Text style={styles.soundRowMeta}>
                          {t('sound.useCount', { count: String(s.useCount) })}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <Button
                title={t('common.cancel')}
                variant="outline"
                onPress={() => setSoundPickerOpen(false)}
                style={{ marginTop: Spacing.md }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

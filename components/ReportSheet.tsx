import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { CHILD_HELPLINE, CONTACT_EMAIL, PHAROS_URL, POLICE_NUMBER } from '@/constants/legal';
import { useI18n } from '@/context/I18nContext';
import {
  EVIDENCE_MAX_FILES,
  P0_CATEGORY,
  REPORT_CATEGORIES,
  REPORT_DETAILS_MAX,
  allowsEvidence,
  checkEvidence,
  createReport,
  uploadReportEvidence,
  type EvidenceFile,
  type ReportCategoryId,
} from '@/lib/reports';
import { localFileSize, uploadToStorage } from '@/lib/upload';
import type { ReportTargetType } from '@/types/database';

type Props = {
  visible: boolean;
  onClose: () => void;
  reporterId?: string | null;
  targetType: ReportTargetType;
  targetId: string;
  /**
   * Appelé en cas d'échec, avec un message déjà traduit. Le succès est
   * affiché dans la feuille elle-même (accusé de réception).
   */
  onDone?: (message: string) => void;
};

type Step = 'categories' | 'p0' | 'details' | 'done';

type Done = {
  p0: boolean;
  mock: boolean;
  already: boolean;
  evidenceNote: string | null;
};

const TARGET_TITLE: Record<ReportTargetType, string> = {
  video: 'report.titleVideo',
  user: 'report.titleUser',
  comment: 'report.titleComment',
  live: 'report.titleLive',
  live_comment: 'report.titleComment',
};

/**
 * Signalement v2 : 10 catégories → (P0 : écran PHAROS / 119 / 17, sans pièce
 * jointe) ou (précisions + jusqu'à 3 preuves) → accusé de réception.
 */
export function ReportSheet({ visible, onClose, reporterId, targetType, targetId, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('categories');
  const [category, setCategory] = useState<ReportCategoryId | null>(null);
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep('categories');
      setCategory(null);
      setDetails('');
      setFiles([]);
      setFileError(null);
      setSending(false);
      setDone(null);
    }
  }, [visible]);

  const choose = (id: ReportCategoryId) => {
    setCategory(id);
    setStep(id === P0_CATEGORY ? 'p0' : 'details');
  };

  const pickEvidence = async () => {
    setFileError(null);
    const room = EVIDENCE_MAX_FILES - files.length;
    if (room <= 0) return;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: 0.85,
      });
      if (res.canceled) return;
      const next: EvidenceFile[] = [];
      for (const a of res.assets.slice(0, room)) {
        const f: EvidenceFile = {
          localUri: a.uri,
          mimeType: a.mimeType ?? null,
          fileName: a.fileName ?? null,
          size: localFileSize(a.uri) ?? a.fileSize ?? null,
          mediaKind: a.type === 'video' ? 'video' : 'image',
        };
        const check = checkEvidence(f);
        if (!check.ok) {
          setFileError(t(check.errorKey));
          continue;
        }
        next.push(f);
      }
      setFiles((prev) => [...prev, ...next].slice(0, EVIDENCE_MAX_FILES));
    } catch {
      setFileError(t('report.evidenceFailed'));
    }
  };

  const submit = async () => {
    if (sending || !category) return;
    setSending(true);
    try {
      const result = await createReport({
        reporterId,
        targetType,
        targetId,
        category,
        details: category === P0_CATEGORY ? null : details,
      });
      if (!result.ok) {
        onDone?.(t(result.errorKey, { email: CONTACT_EMAIL }));
        if (result.errorKey === 'report.unavailable' || result.errorKey === 'report.signInRequired') {
          onClose();
        }
        return;
      }
      let evidenceNote: string | null = null;
      if (allowsEvidence(category) && files.length > 0 && !result.mock && !result.alreadyReported) {
        if (!result.v2 || !result.reportId || !reporterId) {
          evidenceNote = t('report.evidenceUnavailable');
        } else {
          const up = await uploadReportEvidence({
            reporterId,
            reportId: result.reportId,
            files,
            upload: (a) => uploadToStorage({ ...a, upsert: false }),
            localFileSize,
          });
          if (up.failed > 0) evidenceNote = t('report.evidencePartial', { count: up.uploaded });
        }
      }
      setDone({
        p0: category === P0_CATEGORY,
        mock: result.mock,
        already: result.alreadyReported,
        evidenceNote,
      });
      setStep('done');
    } finally {
      setSending(false);
    }
  };

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => onDone?.(t('report.linkError', { url })));
  };

  const header = (
    <>
      <View style={styles.handle} />
      <View style={styles.headerRow}>
        {step === 'p0' || step === 'details' ? (
          <Pressable
            onPress={() => setStep('categories')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            disabled={sending}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.sable} />
          </Pressable>
        ) : null}
        <Text style={styles.title}>{t(TARGET_TITLE[targetType])}</Text>
      </View>
    </>
  );

  const P0Links = () => (
    <View style={styles.p0Links}>
      <Pressable style={styles.linkBtn} onPress={() => open(PHAROS_URL)} accessibilityRole="link">
        <Ionicons name="shield-checkmark-outline" size={18} color={Colors.or} />
        <Text style={styles.linkText}>{t('report.p0Pharos')}</Text>
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => open(`tel:${CHILD_HELPLINE}`)} accessibilityRole="link">
        <Ionicons name="call-outline" size={18} color={Colors.or} />
        <Text style={styles.linkText}>{t('report.p0Call119')}</Text>
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => open(`tel:${POLICE_NUMBER}`)} accessibilityRole="link">
        <Ionicons name="alert-circle-outline" size={18} color={Colors.or} />
        <Text style={styles.linkText}>{t('report.p0Call17')}</Text>
      </Pressable>
    </View>
  );

  let body: React.ReactNode = null;
  if (step === 'categories') {
    body = (
      <>
        <Text style={styles.subtitle}>{t('report.question')}</Text>
        {REPORT_CATEGORIES.map((c) => (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => choose(c.id)}
            accessibilityRole="button"
          >
            <Text style={[styles.rowLabel, c.id === P0_CATEGORY && styles.rowLabelP0]}>{t(c.key)}</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </Pressable>
        ))}
      </>
    );
  } else if (step === 'p0') {
    body = (
      <>
        <View style={styles.p0Box}>
          <Ionicons name="warning-outline" size={20} color={Colors.or} />
          <Text style={styles.p0Title}>{t('report.p0Title')}</Text>
        </View>
        <Text style={styles.p0Body}>{t('report.p0NoCopy')}</Text>
        <Text style={styles.p0Body}>{t('report.p0Hidden')}</Text>
        <Text style={styles.p0Body}>{t('report.p0Authorities')}</Text>
        <P0Links />
        <Pressable style={[styles.primary, sending && styles.disabled]} onPress={() => void submit()} disabled={sending}>
          {sending ? <ActivityIndicator color={Colors.noir} /> : <Text style={styles.primaryText}>{t('report.send')}</Text>}
        </Pressable>
      </>
    );
  } else if (step === 'details' && category) {
    body = (
      <>
        <Text style={styles.subtitle}>{t(REPORT_CATEGORIES.find((c) => c.id === category)!.key)}</Text>
        <Text style={styles.label}>{t('report.detailsLabel')}</Text>
        <TextInput
          style={styles.input}
          value={details}
          onChangeText={(v) => setDetails(v.slice(0, REPORT_DETAILS_MAX))}
          placeholder={t('report.detailsPlaceholder')}
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={REPORT_DETAILS_MAX}
          editable={!sending}
        />
        <Text style={styles.counter}>
          {details.length}/{REPORT_DETAILS_MAX}
        </Text>
        <Text style={styles.label}>{t('report.evidenceLabel')}</Text>
        <Text style={styles.hint}>{t('report.evidenceHint')}</Text>
        <View style={styles.files}>
          {files.map((f, i) => (
            <View key={`${f.localUri}-${i}`} style={styles.fileChip}>
              <Ionicons name={f.mediaKind === 'video' ? 'videocam-outline' : 'image-outline'} size={16} color={Colors.sable} />
              <Text style={styles.fileText}>{t('report.evidenceItem', { count: i + 1 })}</Text>
              <Pressable
                onPress={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('report.evidenceRemove')}
                disabled={sending}
              >
                <Ionicons name="close" size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {files.length < EVIDENCE_MAX_FILES ? (
            <Pressable style={styles.addFile} onPress={() => void pickEvidence()} disabled={sending}>
              <Ionicons name="attach-outline" size={16} color={Colors.or} />
              <Text style={styles.addFileText}>{t('report.evidenceAdd')}</Text>
            </Pressable>
          ) : null}
        </View>
        {fileError ? <Text style={styles.error}>{fileError}</Text> : null}
        <Pressable style={[styles.primary, sending && styles.disabled]} onPress={() => void submit()} disabled={sending}>
          {sending ? <ActivityIndicator color={Colors.noir} /> : <Text style={styles.primaryText}>{t('report.send')}</Text>}
        </Pressable>
      </>
    );
  } else if (step === 'done' && done) {
    body = (
      <>
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark-circle-outline" size={44} color={Colors.or} />
        </View>
        <Text style={styles.doneTitle}>{t('report.doneTitle')}</Text>
        <Text style={styles.p0Body}>
          {done.mock ? t('report.sentMock') : done.already ? t('report.alreadyReported') : t('report.doneBody')}
        </Text>
        {done.evidenceNote ? <Text style={styles.hint}>{done.evidenceNote}</Text> : null}
        {done.p0 ? (
          <>
            <Text style={styles.p0Body}>{t('report.p0Reminder')}</Text>
            <P0Links />
          </>
        ) : null}
        <Pressable style={styles.primary} onPress={onClose}>
          <Text style={styles.primaryText}>{t('report.close')}</Text>
        </Pressable>
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={sending ? undefined : onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
          {header}
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {body}
          </ScrollView>
          {step !== 'done' ? (
            <Pressable style={styles.cancel} onPress={onClose} disabled={sending}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: Colors.noirElevated,
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '88%',
  },
  scroll: { flexGrow: 0 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  title: { color: Colors.sable, fontFamily: Fonts.bold, fontSize: 18 },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowLabel: { color: Colors.sable, fontFamily: Fonts.medium, fontSize: 15, flexShrink: 1 },
  rowLabelP0: { color: Colors.or },
  label: { color: Colors.sable, fontFamily: Fonts.medium, fontSize: 14, marginTop: Spacing.sm, marginBottom: 6 },
  hint: { color: Colors.textMuted, fontFamily: Fonts.regular, fontSize: 12, marginBottom: Spacing.sm },
  input: {
    minHeight: 90,
    maxHeight: 160,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    padding: Spacing.sm,
    color: Colors.sable,
    fontFamily: Fonts.regular,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', color: Colors.textMuted, fontSize: 11, marginTop: 4 },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fileText: { color: Colors.sable, fontFamily: Fonts.regular, fontSize: 12 },
  addFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.or,
  },
  addFileText: { color: Colors.or, fontFamily: Fonts.medium, fontSize: 12 },
  error: { color: Colors.or, fontFamily: Fonts.regular, fontSize: 12, marginTop: Spacing.sm },
  p0Box: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  p0Title: { color: Colors.or, fontFamily: Fonts.bold, fontSize: 15, flexShrink: 1 },
  p0Body: {
    color: Colors.textSecondary,
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: Spacing.sm,
  },
  p0Links: { gap: Spacing.sm, marginVertical: Spacing.sm },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  linkText: { color: Colors.sable, fontFamily: Fonts.medium, fontSize: 14, flexShrink: 1 },
  primary: {
    marginTop: Spacing.md,
    backgroundColor: Colors.or,
    borderRadius: Radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: Colors.noir, fontFamily: Fonts.bold, fontSize: 15 },
  disabled: { opacity: 0.6 },
  doneIcon: { alignItems: 'center', marginVertical: Spacing.sm },
  doneTitle: {
    color: Colors.sable,
    fontFamily: Fonts.bold,
    fontSize: 17,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  cancel: { marginTop: Spacing.sm, alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 15 },
});

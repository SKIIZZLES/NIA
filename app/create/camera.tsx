/**
 * Caméra NIA — V1, vidéo uniquement.
 *
 * Périmètre volontairement réduit : viseur, bascule avant/arrière,
 * enregistrement, compteur, accès galerie. Pas de flash, pas de minuterie,
 * pas de filtre, pas de montage.
 *
 * Le fichier produit reste sur le disque (cache de l'app) et ne circule que
 * sous forme d'URI jusqu'à UploadTask. Aucun fetch, aucun arrayBuffer, aucun
 * base64 : c'est la contrainte héritée de la Phase 2.
 *
 * Le mode photo n'est pas concerné — il garde la caméra système.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { useCreateDraft } from '@/context/CreateContext';
import { useI18n } from '@/context/I18nContext';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_DURATION_SEC } from '@/constants/publish';
import { deleteCachedFile } from '@/lib/upload';

/**
 * 720p : compromis assumé entre lisibilité et budget de 50 Mo. En 1080p le
 * plafond de taille est atteint en quelques dizaines de secondes.
 * Les types signalent cette valeur comme « Android only » — sur iOS le réglage
 * est ignoré et le système choisit sa qualité.
 */
const VIDEO_QUALITY = '720p' as const;

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Phase = 'idle' | 'recording' | 'processing';

export default function CreateCameraScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { applyCapturedVideo, captureMedia, pickMedia } = useCreateDraft();

  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);

  /** Marque un enregistrement dont le résultat doit être jeté (abandon). */
  const abandonRef = useRef(false);
  /** true quand l'abandon vient d'un geste explicite et doit fermer l'écran. */
  const leaveAfterAbandonRef = useRef(false);
  /** Évite de rejouer le repli caméra système en boucle. */
  const fallbackDoneRef = useRef(false);
  /**
   * Horodatage du début d'enregistrement. La durée ne peut pas être lue dans
   * l'état React après l'await : la closure de `record` a capturé la valeur du
   * démarrage, soit zéro.
   */
  const startedAtRef = useRef(0);

  const micGranted = micPermission?.granted === true;

  // --- Compteur de durée. Purement visuel : la limite réelle est appliquée
  // nativement par maxDuration / maxFileSize passés à recordAsync.
  useEffect(() => {
    if (phase !== 'recording') return;
    setSeconds(0);
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [phase]);

  const stopRecording = useCallback(() => {
    try {
      cameraRef.current?.stopRecording();
    } catch {
      // pas d'enregistrement en cours : rien à arrêter
    }
  }, []);

  // --- Arrêt propre quand l'application passe en arrière-plan.
  // Le fichier éventuel est jeté : l'utilisateur n'a pas choisi de le garder.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && phase === 'recording') {
        abandonRef.current = true;
        stopRecording();
      }
    });
    return () => sub.remove();
  }, [phase, stopRecording]);

  // --- Retour matériel Android : pendant l'enregistrement il arrête au lieu
  // de quitter l'écran en laissant une session native ouverte.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'recording') {
        abandonRef.current = true;
        leaveAfterAbandonRef.current = true;
        stopRecording();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [phase, stopRecording]);

  // --- Perte de focus : arrêter tout enregistrement. Le démontage de
  // CameraView (conditionné par isFocused au rendu) libère la session native.
  useEffect(() => {
    if (isFocused) return;
    abandonRef.current = true;
    stopRecording();
  }, [isFocused, stopRecording]);

  const close = useCallback(() => {
    if (phase === 'recording') {
      abandonRef.current = true;
      leaveAfterAbandonRef.current = true;
      stopRecording();
      return;
    }
    router.back();
  }, [phase, stopRecording, router]);

  const record = useCallback(async () => {
    if (!cameraRef.current || phase !== 'idle' || !ready) return;
    abandonRef.current = false;
    leaveAfterAbandonRef.current = false;
    startedAtRef.current = Date.now();
    setPhase('recording');
    let result: { uri: string } | undefined;
    try {
      // maxDuration et maxFileSize existent bien dans CameraRecordingOptions
      // de expo-camera 57.0.5 : c'est la couche native qui coupe, pas un timer JS.
      result = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_SEC,
        maxFileSize: MAX_UPLOAD_BYTES,
      });
    } catch {
      setPhase('idle');
      Alert.alert(t('common.error'), t('camera.recordFailed'));
      return;
    }

    setPhase('processing');
    const uri = result?.uri;

    if (abandonRef.current || !uri) {
      if (uri) deleteCachedFile(uri);
      setPhase('idle');
      // On ne referme que si l'abandon vient d'un geste explicite. Un abandon
      // provoqué par une perte de focus ou un passage en arrière-plan a déjà
      // quitté l'écran : dépiler à nouveau sortirait du parcours.
      if (leaveAfterAbandonRef.current) router.back();
      return;
    }

    const accepted = applyCapturedVideo({
      uri,
      durationMs: Date.now() - startedAtRef.current,
    });
    if (!accepted) {
      // Refusé par les gardes taille/durée : on ne garde pas le fichier et on
      // laisse l'utilisateur refilmer plutôt que de revenir les mains vides.
      deleteCachedFile(uri);
      setPhase('idle');
      return;
    }
    setPhase('idle');
    router.back();
  }, [phase, ready, applyCapturedVideo, router, t]);

  /**
   * Repli caméra système, déclenché uniquement si CameraView ne démarre pas.
   * Une seule tentative : pas de boucle. Le repli emprunte `captureMedia`,
   * donc le pipeline `applyAsset` existant, inchangé.
   */
  const fallbackToSystemCamera = useCallback(async () => {
    if (fallbackDoneRef.current) {
      router.back();
      return;
    }
    fallbackDoneRef.current = true;
    Alert.alert(t('camera.mountErrorTitle'), t('camera.mountErrorBody'));
    try {
      await captureMedia();
    } catch {
      Alert.alert(t('common.error'), t('camera.recordFailed'));
    }
    router.back();
  }, [captureMedia, router, t]);

  const openGallery = useCallback(async () => {
    await pickMedia();
    router.back();
  }, [pickMedia, router]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: '#000' },
        fill: { flex: 1 },
        centered: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.xl,
          gap: Spacing.md,
        },
        gateTitle: {
          color: colors.sable,
          fontFamily: Fonts.bold,
          fontSize: 20,
          textAlign: 'center',
        },
        gateBody: {
          color: colors.textSecondary,
          fontFamily: Fonts.regular,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
        },
        topBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: Spacing.lg,
        },
        bottomBar: {
          position: 'absolute',
          left: 0,
          right: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: Spacing.xl,
        },
        iconBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)',
        },
        recordOuter: {
          width: 76,
          height: 76,
          borderRadius: 38,
          borderWidth: 4,
          borderColor: '#FFF',
          alignItems: 'center',
          justifyContent: 'center',
        },
        recordInner: {
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: colors.or,
        },
        recordInnerStop: {
          width: 30,
          height: 30,
          borderRadius: 6,
          backgroundColor: '#E5484D',
        },
        timer: {
          position: 'absolute',
          left: 0,
          right: 0,
          alignItems: 'center',
        },
        timerText: {
          color: '#FFF',
          fontFamily: Fonts.bold,
          fontSize: 16,
          backgroundColor: 'rgba(0,0,0,0.5)',
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: Radii.pill,
          overflow: 'hidden',
        },
        micWarn: {
          position: 'absolute',
          left: Spacing.lg,
          right: Spacing.lg,
          backgroundColor: 'rgba(0,0,0,0.6)',
          borderRadius: Radii.md,
          paddingHorizontal: Spacing.md,
          paddingVertical: 8,
        },
        micWarnText: {
          color: colors.sable,
          fontFamily: Fonts.medium,
          fontSize: 12,
          textAlign: 'center',
        },
      }),
    [colors],
  );

  // --- Portail de permissions. Rien n'est demandé automatiquement au montage :
  // l'utilisateur déclenche la demande, ce qui évite une boîte système surgie
  // sans contexte.
  if (!camPermission) {
    return (
      <View style={styles.root}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.or} />
        </View>
      </View>
    );
  }

  if (!camPermission.granted) {
    const canAsk = camPermission.canAskAgain;
    return (
      <View style={styles.root}>
        <View style={styles.centered}>
          <Ionicons name="videocam-off-outline" size={44} color={colors.textMuted} />
          <Text style={styles.gateTitle}>{t('camera.permissionTitle')}</Text>
          <Text style={styles.gateBody}>
            {canAsk ? t('camera.permissionBody') : t('camera.permissionDenied')}
          </Text>
          <Button
            title={canAsk ? t('camera.allow') : t('camera.openSettings')}
            variant="gold"
            onPress={() => {
              if (canAsk) void requestCamPermission();
              else void Linking.openSettings();
            }}
          />
          <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Monté seulement quand l'écran a le focus : une seule session caméra
          peut être active, et la laisser vivre hors focus la bloquerait pour
          le reste de l'application. */}
      {isFocused ? (
        <CameraView
          ref={cameraRef}
          style={styles.fill}
          facing={facing}
          mode="video"
          videoQuality={VIDEO_QUALITY}
          mute={!micGranted}
          onCameraReady={() => setReady(true)}
          onMountError={() => void fallbackToSystemCamera()}
        />
      ) : (
        <View style={styles.fill} />
      )}

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={close}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('camera.close')}
        >
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <Pressable
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          disabled={phase !== 'idle'}
          style={[styles.iconBtn, phase !== 'idle' && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel={t('camera.flip')}
        >
          <Ionicons name="camera-reverse-outline" size={24} color="#FFF" />
        </Pressable>
      </View>

      {!micGranted ? (
        <View style={[styles.micWarn, { top: insets.top + 64 }]}>
          <Text style={styles.micWarnText}>{t('camera.micDenied')}</Text>
          {micPermission?.canAskAgain ? (
            <Button
              title={t('camera.allowMic')}
              variant="outline"
              onPress={() => void requestMicPermission()}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </View>
      ) : null}

      {phase === 'recording' ? (
        <View style={[styles.timer, { bottom: insets.bottom + 140 }]}>
          <Text style={styles.timerText}>{formatDuration(seconds)}</Text>
        </View>
      ) : null}

      <View style={[styles.bottomBar, { bottom: Math.max(insets.bottom, 16) + Spacing.md }]}>
        <Pressable
          onPress={() => void openGallery()}
          disabled={phase !== 'idle'}
          style={[styles.iconBtn, phase !== 'idle' && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel={t('camera.gallery')}
        >
          <Ionicons name="images-outline" size={24} color="#FFF" />
        </Pressable>

        <Pressable
          onPress={() => (phase === 'recording' ? stopRecording() : void record())}
          disabled={phase === 'processing' || !ready}
          style={[styles.recordOuter, (phase === 'processing' || !ready) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={
            phase === 'recording' ? t('camera.stop') : t('camera.record')
          }
        >
          {phase === 'processing' ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <View style={phase === 'recording' ? styles.recordInnerStop : styles.recordInner} />
          )}
        </Pressable>

        {/* Symétrie visuelle : occupe la largeur du bouton galerie. */}
        <View style={styles.iconBtn} pointerEvents="none" />
      </View>
    </View>
  );
}

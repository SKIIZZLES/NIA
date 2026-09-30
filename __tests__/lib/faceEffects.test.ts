/**
 * A1 — masques visage : logique pure de l'écran caméra.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FACE_EFFECT_ORDER,
  FACE_NOTICE_KEY,
  acceptFaceNotice,
  faceEffectA11yKey,
  faceEffectShortLabelKey,
  formatFaceStats,
  hasAcceptedFaceNotice,
  isAnalysisFrameBlank,
  isFaceShutterBlocked,
  isLandmarkFaceEffect,
  nativeFaceEffect,
  nextFaceEffect,
} from '@/lib/faceEffects';
import fr from '@/locales/fr';
import { isNiaCameraAvailable } from '@/modules/nia-camera';

function frValue(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, seg) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined),
    fr,
  );
}

describe('nextFaceEffect', () => {
  it('parcourt désactivé → flou → pixels → cagoule → intégral → désactivé', () => {
    expect(nextFaceEffect('off')).toBe('blur');
    expect(nextFaceEffect('blur')).toBe('pixelate');
    expect(nextFaceEffect('pixelate')).toBe('skimask');
    expect(nextFaceEffect('skimask')).toBe('fullmask');
    expect(nextFaceEffect('fullmask')).toBe('off');
  });

  it('revient au départ après un tour complet', () => {
    let e = FACE_EFFECT_ORDER[0];
    for (let i = 0; i < FACE_EFFECT_ORDER.length; i++) e = nextFaceEffect(e);
    expect(e).toBe(FACE_EFFECT_ORDER[0]);
  });
});

describe('libellés', () => {
  it.each(FACE_EFFECT_ORDER)('%s a des clés présentes dans fr', (effect) => {
    expect(typeof frValue(faceEffectShortLabelKey(effect))).toBe('string');
    expect(typeof frValue(faceEffectA11yKey(effect))).toBe('string');
  });

  it('l’avis de première utilisation reprend le texte validé', () => {
    const body = frValue('camera.faceNoticeBody') as string;
    expect(body).toContain('ni enregistrés, ni envoyés à NIA ou à un tiers');
    expect(body).toContain('Les lives ne sont pas masqués');
  });
});

describe('masques à repères (jalon 2)', () => {
  it('seuls cagoule et intégral suivent les repères', () => {
    expect(FACE_EFFECT_ORDER.filter(isLandmarkFaceEffect)).toEqual(['skimask', 'fullmask']);
  });

  it('prop native : chaque effet passe tel quel, « désactivé » ne monte pas la caméra à masque', () => {
    expect(nativeFaceEffect('off')).toBeNull();
    expect(nativeFaceEffect('blur')).toBe('blur');
    expect(nativeFaceEffect('pixelate')).toBe('pixelate');
    expect(nativeFaceEffect('skimask')).toBe('skimask');
    expect(nativeFaceEffect('fullmask')).toBe('fullmask');
  });

  it('libellés français', () => {
    expect(frValue('camera.faceMaskShortSki')).toBe('Cagoule');
    expect(frValue('camera.faceMaskShortFull')).toBe('Intégral');
    expect(frValue('camera.faceMaskSki')).toBe('Masquer mon visage : cagoule');
    expect(frValue('camera.faceMaskFull')).toBe('Masquer mon visage : masque intégral');
  });
});

describe('isFaceShutterBlocked', () => {
  it('bloque tant qu’aucun visage n’est repéré, masque actif', () => {
    expect(isFaceShutterBlocked({ maskActive: true, faceDetected: false, recording: false })).toBe(true);
    expect(isFaceShutterBlocked({ maskActive: true, faceDetected: true, recording: false })).toBe(false);
  });

  it('ne bloque jamais sans masque', () => {
    expect(isFaceShutterBlocked({ maskActive: false, faceDetected: false, recording: false })).toBe(false);
  });

  it('ne bloque pas l’arrêt : visage perdu en cours de prise = flou total côté natif', () => {
    expect(isFaceShutterBlocked({ maskActive: true, faceDetected: false, recording: true })).toBe(false);
  });
});

describe('avis de première utilisation', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(FACE_NOTICE_KEY);
  });

  it('n’est pas accepté au départ, puis l’est après acceptation', async () => {
    expect(await hasAcceptedFaceNotice()).toBe(false);
    await acceptFaceNotice();
    expect(await hasAcceptedFaceNotice()).toBe(true);
  });
});

describe('formatFaceStats', () => {
  it('rend quatre lignes lisibles', () => {
    const lines = formatFaceStats({
      renderFps: 29.6,
      analysisFps: 28.1,
      detectMsAvg: 12.4,
      detectMsMax: 30.2,
      latencyMsAvg: 48.2,
      latencyMsMax: 95,
      exact: 28,
      neighbor: 1,
      hold: 0,
      cover: 1,
      syncOk: 28,
      syncMissed: 0,
      mode: 'exact',
    });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('image 30 i/s · analyse 28 i/s');
    expect(lines[1]).toContain('latence 48 ms (max 95)');
  });

  it('latence inconnue : tiret', () => {
    const lines = formatFaceStats({
      renderFps: 0, analysisFps: 0, detectMsAvg: 0, detectMsMax: 0,
      latencyMsAvg: -1, latencyMsMax: -1, exact: 0, neighbor: 0, hold: 0, cover: 0,
      syncOk: 0, syncMissed: 0, mode: 'queue',
    });
    expect(lines[1]).toContain('latence —');
  });

  const base = {
    renderFps: 15, analysisFps: 26, detectMsAvg: 13, detectMsMax: 41,
    latencyMsAvg: 203, latencyMsMax: 229, exact: 0, neighbor: 0, hold: 0, cover: 15,
    syncOk: 14, syncMissed: 9, mode: 'exact',
  };

  it('diagnostic : aperçu, image analysée, détections brutes, dessin', () => {
    const lines = formatFaceStats({
      ...base,
      previewState: 'streaming',
      previewViewSize: '1080x2400',
      frameWidth: 1280,
      frameHeight: 720,
      analysisWidth: 640,
      analysisHeight: 360,
      analysisRotation: 270,
      rotationOffset: 90,
      lumaMean: 112,
      lumaRange: 80,
      rawDetections: 3,
      bestScore: 0.4234,
      drawMsAvg: 6.2,
      drawMsMax: 12.4,
      glWaitMsAvg: 31.6,
    });
    expect(lines).toHaveLength(8);
    expect(lines[4]).toBe('aperçu actif · vue 1080×2400 · cadre 1280×720');
    expect(lines[5]).toBe('analysé 640×360 · rotation 270° (+90° auto) · luminance 112 (écart 80)');
    expect(lines[6]).toBe('visages bruts 3 · meilleur score 0.42');
    expect(lines[7]).toBe('dessin 6 ms (max 12) · attente GL 32 ms');
  });

  it('diagnostic : aperçu inactif et image noire signalés', () => {
    const lines = formatFaceStats({
      ...base,
      previewState: 'idle',
      analysisWidth: 640,
      analysisHeight: 360,
      analysisRotation: 90,
      rotationOffset: 0,
      lumaMean: 3,
      lumaRange: 2,
    });
    expect(lines).toContain('aperçu inactif');
    expect(lines).toContain('analysé 640×360 · rotation 90° · luminance 3 (écart 2)');
    expect(lines[lines.length - 1]).toBe('alerte : image analysée noire ou uniforme');
  });

  it('repères et décomposition de la latence', () => {
    const lines = formatFaceStats({
      ...base,
      cameraToAnalysisMsAvg: 54.4,
      prepMsAvg: 3.6,
      sourceWidth: 640,
      sourceHeight: 480,
      landmarkState: 'ready',
      landmarkMsAvg: 11.2,
      landmarkMsMax: 19.7,
      landmarkFrames: 27,
      fallbackFaces: 1,
      landmarkOnlyFaces: 2,
    });
    expect(lines).toContain('caméra→analyse 54 ms · préparation 4 ms · source 640×480');
    expect(lines).toContain('repères prêts · 11 ms (max 20) · images 27 · repli 1 · seuls 2');
  });

  it('repères désactivés (flou / pixels) : pas de ligne repères', () => {
    const lines = formatFaceStats({ ...base, landmarkState: 'off', cameraToAnalysisMsAvg: -1 });
    expect(lines.some((l) => l.startsWith('repères'))).toBe(false);
    expect(lines).toContain('caméra→analyse — · préparation 0 ms');
  });

  it('ancien APK sans diagnostic : quatre lignes', () => {
    expect(formatFaceStats(base)).toHaveLength(4);
  });
});

describe('isAnalysisFrameBlank', () => {
  it('noire, plate, normale, inconnue', () => {
    expect(isAnalysisFrameBlank({ lumaMean: 4, lumaRange: 30 })).toBe(true);
    expect(isAnalysisFrameBlank({ lumaMean: 120, lumaRange: 2 })).toBe(true);
    expect(isAnalysisFrameBlank({ lumaMean: 120, lumaRange: 70 })).toBe(false);
    expect(isAnalysisFrameBlank({ lumaMean: -1, lumaRange: -1 })).toBe(false);
    expect(isAnalysisFrameBlank({})).toBe(false);
  });
});

describe('module nia-camera hors Android natif', () => {
  it('est indisponible en test : la caméra habituelle reste seule', () => {
    expect(isNiaCameraAvailable()).toBe(false);
  });
});

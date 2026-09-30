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
  isFaceShutterBlocked,
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
  it('parcourt désactivé → flou → pixels → désactivé', () => {
    expect(nextFaceEffect('off')).toBe('blur');
    expect(nextFaceEffect('blur')).toBe('pixelate');
    expect(nextFaceEffect('pixelate')).toBe('off');
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
});

describe('module nia-camera hors Android natif', () => {
  it('est indisponible en test : la caméra habituelle reste seule', () => {
    expect(isNiaCameraAvailable()).toBe(false);
  });
});

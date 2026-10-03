/**
 * A2.0 — accessoires : catalogue, licences (une par objet), rangée
 * « Accessoires » et ligne du panneau des mesures.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ACCESSORIES,
  ACCESSORY_NOTICE_KEY,
  ALLOWED_ACCESSORY_LICENCES,
  acceptAccessoryNotice,
  accessoryById,
  accessoryChips,
  accessoryOutlineLabel,
  hasAcceptedAccessoryNotice,
  isAccessoryActive,
  isAccessoryLicenceValid,
  nativeAccessory,
} from '@/lib/accessories';
import { ACCESSORY_DRAW_BUDGET_MS, formatAccessoryStats, formatFaceStats } from '@/lib/faceEffects';
import fr from '@/locales/fr';

/** Même raison que keysUsed.test.ts : pas de @types/node global. */
type FsMinimal = {
  existsSync(chemin: string): boolean;
  readFileSync(chemin: string, encodage: 'utf8'): string;
};
declare function require(id: string): unknown;
declare const __filename: string;
const fs = require('fs') as FsMinimal;
const ROOT = __filename.replace(/\\/g, '/').replace(/\/__tests__\/lib\/[^/]+$/, '');
const KT = `${ROOT}/modules/nia-camera/android/src/main/java/expo/modules/niacamera/Accessories.kt`;
const drawablePath = (id: string) =>
  `${ROOT}/modules/nia-camera/android/src/main/res/drawable/nia_acc_${id.replace(/-/g, '_')}.xml`;

function frValue(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, seg) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined),
    fr,
  );
}

/** Luminance (Rec. 709, sur les valeurs sRGB 0..1). */
function luma(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Échelle Monk, teinte la plus foncée (MST 10). */
const MST_10 = '#292420';

describe('catalogue', () => {
  it('identifiants uniques, objet de test présent', () => {
    const ids = ACCESSORIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('glasses-sable');
    expect(accessoryById('glasses-sable')?.labelKey).toBe('camera.accessoryGlassesSable');
    expect(accessoryById('inconnu')).toBeNull();
    expect(accessoryById(null)).toBeNull();
  });

  it.each(ACCESSORIES.map((a) => [a.id, a] as const))('%s : licence complète et admise', (id, item) => {
    const l = item.licence;
    expect(l.id).toBe(id);
    expect(isAccessoryLicenceValid(l)).toBe(true);
    expect(ALLOWED_ACCESSORY_LICENCES).toContain(l.licence);
    expect(l.aiGenerated).toBe(false);
    expect(l.author.trim()).not.toBe('');
    expect(l.source.trim()).not.toBe('');
  });

  it.each(ACCESSORIES.map((a) => [a.id] as const))('%s : dessin, source et ancrage natif présents', (id) => {
    expect(fs.existsSync(`${ROOT}/assets/accessories/${id}/licence.json`)).toBe(true);
    expect(fs.existsSync(`${ROOT}/assets/accessories/${id}/${id}.svg`)).toBe(true);
    expect(fs.existsSync(drawablePath(id))).toBe(true);
    const kt = fs.readFileSync(KT, 'utf8');
    expect(kt).toContain(`id = "${id}"`);
    expect(kt).toContain(`drawable = "nia_acc_${id.replace(/-/g, '_')}"`);
  });

  it('le catalogue natif ne déclare rien de plus que le catalogue JS', () => {
    const kt = fs.readFileSync(KT, 'utf8');
    const nativeIds = Array.from(kt.matchAll(/\bid = "([^"]+)"/g)).map((m) => m[1]);
    expect(nativeIds.sort()).toEqual(ACCESSORIES.map((a) => a.id).sort());
  });

  it.each(ACCESSORIES.map((a) => [a.id] as const))(
    '%s : toute teinte translucide est plus sombre que MST 10 (jamais d’éclaircissement)',
    (id) => {
      const xml = fs.readFileSync(drawablePath(id), 'utf8');
      const paths = xml.match(/<path\b[^>]*\/>/g) ?? [];
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        const alpha = /android:fillAlpha="([\d.]+)"/.exec(p);
        const color = /android:fillColor="(#[0-9A-Fa-f]{6})"/.exec(p);
        if (alpha && color && Number(alpha[1]) < 1) {
          expect(luma(color[1])).toBeLessThan(luma(MST_10));
        }
      }
    },
  );

  it('libellés français présents', () => {
    for (const a of ACCESSORIES) expect(typeof frValue(a.labelKey)).toBe('string');
    for (const c of accessoryChips()) expect(typeof frValue(c.labelKey)).toBe('string');
    expect(frValue('camera.accessories')).toBe('Accessoires');
    expect(String(frValue('camera.accessoryNoticeBody'))).toContain('ne vous cache pas');
  });
});

describe('licence', () => {
  const ok = ACCESSORIES[0].licence;
  it('refuse une image générée par IA, une licence non admise ou un auteur manquant', () => {
    expect(isAccessoryLicenceValid({ ...ok, aiGenerated: true })).toBe(false);
    expect(isAccessoryLicenceValid({ ...ok, licence: 'CC-BY-NC-4.0' })).toBe(false);
    expect(isAccessoryLicenceValid({ ...ok, author: ' ' })).toBe(false);
    expect(isAccessoryLicenceValid({ ...ok, licence: 'CC0-1.0' })).toBe(true);
    expect(isAccessoryLicenceValid(null)).toBe(false);
  });
});

describe('rangée « Accessoires »', () => {
  const base = { available: true, accessory: 'glasses-sable', faceEffect: 'off', photo: false };
  it('actif seulement en vidéo, sans masque, objet connu, module présent', () => {
    expect(isAccessoryActive(base)).toBe(true);
    expect(isAccessoryActive({ ...base, available: false })).toBe(false);
    expect(isAccessoryActive({ ...base, accessory: 'off' })).toBe(false);
    expect(isAccessoryActive({ ...base, accessory: 'inconnu' })).toBe(false);
    expect(isAccessoryActive({ ...base, photo: true })).toBe(false);
    expect(isAccessoryActive({ ...base, faceEffect: 'skimask' })).toBe(false);
  });

  it('prop native : identifiant seulement si actif', () => {
    expect(nativeAccessory('glasses-sable', true)).toBe('glasses-sable');
    expect(nativeAccessory('glasses-sable', false)).toBeNull();
    expect(nativeAccessory('off', true)).toBeNull();
  });

  it('« Aucun » en premier, puis le catalogue', () => {
    const chips = accessoryChips();
    expect(chips[0]).toMatchObject({ id: 'off', labelKey: 'camera.accessoryNone' });
    expect(chips.slice(1).map((c) => c.id)).toEqual(ACCESSORIES.map((a) => a.id));
  });

  it('interrupteur des repères (panneau)', () => {
    expect(accessoryOutlineLabel(true)).toBe("Repères de l'accessoire : oui");
    expect(accessoryOutlineLabel(false)).toBe("Repères de l'accessoire : non");
  });
});

describe('avis « un accessoire ne vous cache pas »', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(ACCESSORY_NOTICE_KEY);
  });
  it('distinct de l’avis des masques', async () => {
    expect(ACCESSORY_NOTICE_KEY).not.toBe('nia.faceEffects.noticeAccepted.v1');
    expect(await hasAcceptedAccessoryNotice()).toBe(false);
    await acceptAccessoryNotice();
    expect(await hasAcceptedAccessoryNotice()).toBe(true);
  });
});

describe('panneau des mesures (mode accessoire)', () => {
  const base = {
    renderFps: 30, analysisFps: 28, detectMsAvg: 10, detectMsMax: 20,
    latencyMsAvg: 90, latencyMsMax: 110, exact: 0, neighbor: 0, hold: 0, live: 28, cover: 2,
    syncOk: 0, syncMissed: 0, mode: 'live',
  };
  const acc = {
    ...base, effect: 'accessory', accessoryDrawMsAvg: 1.234, accessoryDrawMsMax: 2.6,
    accessoryFrames: 27, accessoryHidden: 3, poseYawDeg: 12.4, posePitchDeg: -10.6, poseFrames: 27,
  };

  it('coût du dessin, posés / cachés, pose de la tête', () => {
    expect(formatAccessoryStats(acc)).toBe(
      'accessoire 1.2 ms (max 2.6) · posé 27 · caché 3 · lacet 12° · tangage -11°',
    );
    expect(formatFaceStats(acc)).toContain(formatAccessoryStats(acc));
  });

  it('alerte au-delà du budget de 4 ms ; pose inconnue : tiret', () => {
    expect(ACCESSORY_DRAW_BUDGET_MS).toBe(4);
    expect(formatAccessoryStats({ ...acc, accessoryDrawMsMax: 4.5 })).toContain('(max 4.5) ⚠');
    expect(formatAccessoryStats({ ...acc, poseFrames: 0 })).toContain('pose —');
  });

  it('« sans visage » au lieu de « flou total » (rien n’est flouté)', () => {
    expect(formatFaceStats(acc)[2]).toBe('direct 28 · sans visage 2');
    expect(formatFaceStats({ ...base, effect: 'skimask' })[2]).toBe('direct 28 · flou total 2');
  });

  it('hors mode accessoire ou ancien APK : pas de ligne', () => {
    expect(formatAccessoryStats({ ...acc, effect: 'blur' })).toBeNull();
    expect(formatAccessoryStats({ ...base, effect: 'accessory' })).toBeNull();
  });
});

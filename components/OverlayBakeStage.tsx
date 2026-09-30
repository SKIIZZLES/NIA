/**
 * Éditeur V2 — capture des calques pour l'incrustation.
 *
 * `useOverlayBaker()` rend une scène invisible (hors de l'écran) où chaque
 * calque est dessiné par `OverlayContent`, le même composant que l'aperçu,
 * dans un cadre de `frameWidthPx` pixels : même police, même mise en page,
 * même halo. Chaque calque est capturé en PNG transparent, sans rotation
 * (NiaComposer l'applique). Les fichiers sont dans le cache ; l'appelant les
 * supprime après l'export (`releaseBakedFiles`).
 *
 * Les polices sont chargées (et attendues) avant la capture : sans elles, la
 * vidéo recevrait la police système alors que l'aperçu montrait la bonne.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import * as Font from 'expo-font';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { OverlayContent } from '@/components/OverlayItemView';
import { OVERLAY_FONT_SOURCES } from '@/constants/overlayFonts';
import type { BakePlan } from '@/lib/overlayBake';

type Job = {
  plan: BakePlan;
  frameWidthDp: number;
  resolve: (captures: Map<string, string>) => void;
  reject: (e: unknown) => void;
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toFileUri(uri: string): string {
  return uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`;
}

export function releaseBakedFiles(captures: ReadonlyMap<string, string> | null | undefined) {
  if (!captures) return;
  // releaseCapture ne supprime que les fichiers de ses dossiers de cache.
  for (const uri of captures.values()) {
    try {
      releaseCapture(uri);
    } catch {
      // cache jetable
    }
  }
}

export function useOverlayBaker() {
  const [job, setJob] = useState<Job | null>(null);
  const refs = useRef(new Map<string, View | null>());
  const laidOut = useRef(new Set<string>());

  const bake = useCallback(async (plan: BakePlan): Promise<Map<string, string>> => {
    await Font.loadAsync(OVERLAY_FONT_SOURCES);
    refs.current.clear();
    laidOut.current.clear();
    return new Promise<Map<string, string>>((resolve, reject) => {
      setJob({ plan, frameWidthDp: plan.frameWidthPx / PixelRatio.get(), resolve, reject });
    });
  }, []);

  useEffect(() => {
    if (!job) return;
    let alive = true;
    void (async () => {
      const captures = new Map<string, string>();
      try {
        // Mise en page terminée pour tous les calques (2 s au plus), puis deux
        // images pour que le texte soit dessiné.
        for (let i = 0; i < 40 && laidOut.current.size < job.plan.items.length; i += 1) await wait(50);
        await nextFrame();
        await nextFrame();
        for (const it of job.plan.items) {
          const view = refs.current.get(it.overlay.id);
          if (!view) throw new Error('Overlay view missing');
          const uri = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
          captures.set(it.overlay.id, toFileUri(uri));
        }
        // Toujours réglée : l'appelant (export) ne doit jamais rester en attente.
        job.resolve(captures);
      } catch (e) {
        releaseBakedFiles(captures);
        job.reject(e);
      } finally {
        if (alive) setJob(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [job]);

  const stage = job ? (
    <View pointerEvents="none" style={[styles.stage, { width: job.frameWidthDp * 3, left: -job.frameWidthDp * 4 }]}>
      {job.plan.items.map((it) => (
        <View key={it.overlay.id} style={[styles.slot, { width: job.frameWidthDp * 3 }]}>
          <View
            onLayout={() => {
              laidOut.current.add(it.overlay.id);
            }}
          >
            <OverlayContent
              ref={(v) => {
                refs.current.set(it.overlay.id, v);
              }}
              overlay={{ ...it.overlay, rotation: 0 }}
              frameWidth={job.frameWidthDp}
            />
          </View>
        </View>
      ))}
    </View>
  ) : null;

  return { bake, stage };
}

const styles = StyleSheet.create({
  stage: { position: 'absolute', top: 0 },
  // Chaque calque à sa taille naturelle ; boîte large : seule la largeur
  // maximale du texte (proportionnelle au cadre) le fait revenir à la ligne.
  slot: { position: 'absolute', left: 0, top: 0, alignItems: 'flex-start' },
});

/**
 * Calques texte / stickers modifiables (écran d'édition, sprint S4).
 *
 * Gestes (PanResponder, sans dépendance native) :
 * - un doigt : déplacer ; glisser jusqu'à la corbeille en bas pour supprimer ;
 * - deux doigts : pincer pour la taille, tourner pour l'angle ;
 * - toucher : sélectionner (et modifier un texte déjà sélectionné) ;
 * - appui long : proposer la suppression.
 *
 * Pendant un geste, les valeurs vivent dans l'état du calque : le brouillon
 * n'est mis à jour qu'au relâchement (pas de rendu de tout l'écran à chaque
 * mouvement).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OverlayItemView } from '@/components/OverlayItemView';
import { useColors } from '@/context/ThemeContext';
import { Fonts, Radii } from '@/constants/theme';
import {
  MAX_OVERLAY_SIZE,
  MIN_OVERLAY_SIZE,
  coverFrameRect,
  isOverlayVisible,
  normalizeRotation,
  type FrameRect,
  type Overlay,
  type OverlayDoc,
} from '@/lib/overlays';

const LONG_PRESS_MS = 550;
const MOVE_SLOP = 6;
const TRASH_SIZE = 64;

type Transform = Pick<Overlay, 'x' | 'y' | 'size' | 'rotation'>;

type Props = {
  doc: OverlayDoc;
  /** Instant courant de la vidéo publiée (ms) ; null = tout afficher. */
  timeMs: number | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Toucher un texte déjà sélectionné : l'ouvrir pour le modifier. */
  onEditText: (id: string) => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
  onDelete: (id: string) => void;
  onLongPress: (id: string) => void;
  /** Distance du bas de l'écran à laquelle poser la corbeille. */
  trashBottom: number;
  trashLabel: string;
  itemLabel: (o: Overlay) => string;
  /** Un calque est en cours de déplacement (l'écran masque ses barres). */
  onDraggingChange?: (dragging: boolean) => void;
};

export function OverlayEditor({
  doc,
  timeMs,
  selectedId,
  onSelect,
  onEditText,
  onChange,
  onDelete,
  onLongPress,
  trashBottom,
  trashLabel,
  itemLabel,
  onDraggingChange,
}: Props) {
  const colors = useColors();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ id: string; overTrash: boolean } | null>(null);
  const dragging = drag != null;
  const draggingCb = useRef(onDraggingChange);
  draggingCb.current = onDraggingChange;
  useEffect(() => {
    draggingCb.current?.(dragging);
  }, [dragging]);
  const frame = coverFrameRect(size.w, size.h, doc.aspect);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((cur) => (cur.w === width && cur.h === height ? cur : { w: width, h: height }));
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      {doc.items.map((o) => {
        const visible = isOverlayVisible(o, timeMs) || o.id === selectedId || drag?.id === o.id;
        if (!visible) return null;
        return (
          <EditableOverlay
            key={o.id}
            overlay={o}
            frame={frame}
            selected={o.id === selectedId}
            selectionColor={colors.or}
            trashBottom={trashBottom}
            label={itemLabel(o)}
            onTap={() => {
              if (o.id === selectedId && o.type === 'text') onEditText(o.id);
              else onSelect(o.id);
            }}
            onGestureStart={() => onSelect(o.id)}
            onDrag={(overTrash) =>
              setDrag((cur) =>
                cur && cur.id === o.id && cur.overTrash === overTrash ? cur : { id: o.id, overTrash },
              )
            }
            onDragEnd={() => setDrag(null)}
            onCommit={(patch) => onChange(o.id, patch)}
            onDelete={() => onDelete(o.id)}
            onLongPress={() => onLongPress(o.id)}
          />
        );
      })}

      {drag ? (
        <View pointerEvents="none" style={[styles.trashWrap, { bottom: trashBottom }]}>
          <View
            style={[
              styles.trash,
              {
                backgroundColor: drag.overTrash ? colors.danger : colors.noir + 'B3',
                borderColor: drag.overTrash ? colors.danger : colors.border,
                transform: [{ scale: drag.overTrash ? 1.15 : 1 }],
              },
            ]}
          >
            <Ionicons name="trash-outline" size={28} color={colors.onMedia} />
          </View>
          {drag.overTrash ? (
            <Text style={[styles.trashText, { color: colors.onMedia }]}>{trashLabel}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type ItemProps = {
  overlay: Overlay;
  frame: FrameRect;
  selected: boolean;
  selectionColor: string;
  trashBottom: number;
  label: string;
  onTap: () => void;
  onGestureStart: () => void;
  onDrag: (overTrash: boolean) => void;
  onDragEnd: () => void;
  onCommit: (patch: Transform) => void;
  onDelete: () => void;
  onLongPress: () => void;
};

function isOverTrash(e: GestureResponderEvent, trashBottom: number): boolean {
  const { width, height } = Dimensions.get('window');
  const { pageX, pageY } = e.nativeEvent;
  const cy = height - trashBottom - TRASH_SIZE / 2;
  return Math.abs(pageX - width / 2) < TRASH_SIZE * 1.1 && Math.abs(pageY - cy) < TRASH_SIZE * 1.1;
}

function EditableOverlay(props: ItemProps) {
  const { overlay, frame, selected, selectionColor, label } = props;
  const [live, setLive] = useState<Transform | null>(null);

  // Hors geste, l'affichage suit le brouillon.
  const liveRef = useRef<Transform | null>(null);
  const cbs = useRef(props);
  cbs.current = props;

  const responder = useMemo(() => {
    let startT: Transform = { x: 0.5, y: 0.5, size: 0.1, rotation: 0 };
    let moved = false;
    let pinching = false;
    let pinchBase = { dist: 1, angle: 0, size: 0.1, rotation: 0 };
    let dragBase = { x: 0.5, y: 0.5, dx: 0, dy: 0 };
    let grantAt = 0;
    let overTrash = false;
    let longTimer: ReturnType<typeof setTimeout> | null = null;
    let longFired = false;

    const clearLong = () => {
      if (longTimer) clearTimeout(longTimer);
      longTimer = null;
    };
    const set = (t: Transform) => {
      liveRef.current = t;
      setLive(t);
    };
    const finish = (commit: boolean) => {
      clearLong();
      const t = liveRef.current;
      const p = cbs.current;
      if (moved) p.onDragEnd();
      if (commit && moved && overTrash && !pinching) {
        liveRef.current = null;
        p.onDelete();
        return;
      }
      // Brouillon et affichage mis à jour dans le même rendu (lot React).
      if (commit && t && moved) p.onCommit(t);
      setLive(null);
      liveRef.current = null;
      if (commit && !moved && !longFired && Date.now() - grantAt < LONG_PRESS_MS) p.onTap();
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const o = cbs.current.overlay;
        startT = { x: o.x, y: o.y, size: o.size, rotation: o.rotation };
        dragBase = { x: o.x, y: o.y, dx: 0, dy: 0 };
        moved = false;
        pinching = false;
        overTrash = false;
        longFired = false;
        grantAt = Date.now();
        liveRef.current = startT;
        cbs.current.onGestureStart();
        clearLong();
        longTimer = setTimeout(() => {
          if (!moved) {
            longFired = true;
            cbs.current.onLongPress();
          }
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (e, g) => {
        const f = cbs.current.frame;
        if (!(f.width > 0)) return;
        const touches = e.nativeEvent.touches;
        const cur = liveRef.current ?? startT;
        if (touches.length >= 2) {
          const [a, b] = touches;
          const dx = b.pageX - a.pageX;
          const dy = b.pageY - a.pageY;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (!pinching) {
            pinching = true;
            pinchBase = { dist, angle, size: cur.size, rotation: cur.rotation };
          }
          if (!moved) {
            moved = true;
            clearLong();
          }
          const nextSize = Math.min(
            MAX_OVERLAY_SIZE,
            Math.max(MIN_OVERLAY_SIZE, pinchBase.size * (dist / pinchBase.dist)),
          );
          set({
            ...cur,
            size: nextSize,
            rotation: normalizeRotation(pinchBase.rotation + (angle - pinchBase.angle)),
          });
          return;
        }
        if (pinching) {
          // Retour à un doigt : le déplacement repart de la position actuelle.
          pinching = false;
          dragBase = { x: cur.x, y: cur.y, dx: g.dx, dy: g.dy };
        }
        if (!moved && Math.hypot(g.dx, g.dy) < MOVE_SLOP) return;
        if (!moved) {
          moved = true;
          clearLong();
        }
        const x = Math.min(1, Math.max(0, dragBase.x + (g.dx - dragBase.dx) / f.width));
        const y = Math.min(1, Math.max(0, dragBase.y + (g.dy - dragBase.dy) / f.height));
        set({ ...cur, x, y });
        overTrash = isOverTrash(e, cbs.current.trashBottom);
        cbs.current.onDrag(overTrash);
      },
      onPanResponderRelease: () => finish(true),
      onPanResponderTerminate: () => finish(false),
    });
  }, []);

  const shown = live ? ({ ...overlay, ...live } as Overlay) : overlay;
  return (
    <OverlayItemView
      overlay={shown}
      frame={frame}
      selected={selected}
      selectionColor={selectionColor}
      handlers={responder.panHandlers}
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  trashWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
  trash: {
    width: TRASH_SIZE,
    height: TRASH_SIZE,
    borderRadius: TRASH_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashText: { fontFamily: Fonts.medium, fontSize: 13, borderRadius: Radii.pill },
});

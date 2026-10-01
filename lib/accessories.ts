/**
 * Accessoires (A2.0) — catalogue et logique pure de la rangée « Accessoires ».
 *
 * Un accessoire est un objet amusant posé sur le visage par le module natif
 * `modules/nia-camera` (cuit dans l'aperçu ET le fichier, comme les masques).
 * Ce n'est PAS de l'anonymat : sans visage, l'objet disparaît simplement, le
 * déclencheur n'est jamais bloqué, rien n'est flouté. Accessoire et masque
 * s'excluent : en choisir un retire l'autre.
 *
 * Règles du catalogue (assets/accessories/README.md) : dessins créés par NIA,
 * commandés à des créateurs crédités, ou CC0 ; aucune image générée par IA ;
 * relecture culturelle ; jamais de remodelage, de lissage ni
 * d'éclaircissement de la peau. Chaque objet a son fichier de licence.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import glassesSableLicence from '@/assets/accessories/glasses-sable/licence.json';

/** Licences admises pour un objet du catalogue. */
export const ALLOWED_ACCESSORY_LICENCES = ['NIA-original', 'CC0-1.0'] as const;
export type AccessoryLicenceId = (typeof ALLOWED_ACCESSORY_LICENCES)[number];

/** Contenu de `assets/accessories/<id>/licence.json`. */
export type AccessoryLicence = {
  id: string;
  name: string;
  author: string;
  source: string;
  licence: string;
  createdAt: string;
  aiGenerated: boolean;
  culturalReview: string;
  palette?: string[];
  notes?: string;
};

export type AccessoryItem = {
  /** Même identifiant que `AccessoryCatalog` (Accessories.kt). */
  id: string;
  /** Clé i18n du nom affiché. */
  labelKey: string;
  /** Icône Ionicons de la puce. */
  icon: 'glasses-outline';
  licence: AccessoryLicence;
};

export const ACCESSORIES: readonly AccessoryItem[] = [
  {
    id: 'glasses-sable',
    labelKey: 'camera.accessoryGlassesSable',
    icon: 'glasses-outline',
    licence: glassesSableLicence,
  },
];

/** 'off' : aucun accessoire. */
export type AccessoryChoice = 'off' | string;

export function accessoryById(id: string | null | undefined): AccessoryItem | null {
  return ACCESSORIES.find((a) => a.id === id) ?? null;
}

/** Une licence de catalogue complète et admise (contrôlée par les tests). */
export function isAccessoryLicenceValid(l: AccessoryLicence | null | undefined): boolean {
  if (!l) return false;
  const filled = [l.id, l.name, l.author, l.source, l.createdAt, l.culturalReview].every(
    (v) => typeof v === 'string' && v.trim().length > 0,
  );
  return (
    filled &&
    l.aiGenerated === false &&
    (ALLOWED_ACCESSORY_LICENCES as readonly string[]).includes(l.licence)
  );
}

/**
 * Accessoire réellement posé : module natif présent, objet connu choisi,
 * hors photo (A2.0 : vidéo seulement) et sans masque (ils s'excluent).
 */
export function isAccessoryActive(input: {
  available: boolean;
  accessory: AccessoryChoice;
  faceEffect: string;
  photo: boolean;
}): boolean {
  return (
    input.available &&
    input.accessory !== 'off' &&
    accessoryById(input.accessory) != null &&
    !input.photo &&
    input.faceEffect === 'off'
  );
}

/** Valeur de la prop `accessory` du module natif. */
export function nativeAccessory(choice: AccessoryChoice, active: boolean): string | null {
  return active && accessoryById(choice) ? choice : null;
}

/** Puces de la rangée « Accessoires » : « Aucun » puis le catalogue. */
export function accessoryChips(): { id: AccessoryChoice; labelKey: string; icon: string }[] {
  return [
    { id: 'off', labelKey: 'camera.accessoryNone', icon: 'close-circle-outline' },
    ...ACCESSORIES.map((a) => ({ id: a.id, labelKey: a.labelKey, icon: a.icon })),
  ];
}

/** Test (panneau des mesures) : interrupteur des repères d'ancrage. */
export function accessoryOutlineLabel(on: boolean): string {
  return `Repères de l'accessoire : ${on ? 'oui' : 'non'}`;
}

export const ACCESSORY_NOTICE_KEY = 'nia.accessories.noticeAccepted.v1';

/** L'avis « un accessoire ne vous cache pas » a déjà été accepté sur cet appareil. */
export async function hasAcceptedAccessoryNotice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ACCESSORY_NOTICE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function acceptAccessoryNotice(): Promise<void> {
  try {
    await AsyncStorage.setItem(ACCESSORY_NOTICE_KEY, '1');
  } catch {
    // l'avis sera simplement montré de nouveau
  }
}

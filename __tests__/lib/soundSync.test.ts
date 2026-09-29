import {
  clampSoundOffsetMs,
  formatSoundTime,
  needsResync,
  soundTargetSec,
} from '@/lib/soundSync';

describe('soundTargetSec', () => {
  it('ajoute le début du son au temps vidéo', () => {
    expect(soundTargetSec(2, 5000, 60)).toBeCloseTo(7);
  });
  it('boucle un son plus court que la vidéo', () => {
    expect(soundTargetSec(25, 10000, 30)).toBeCloseTo(5);
  });
  it('sans durée connue, ne boucle pas', () => {
    expect(soundTargetSec(25, 10000, 0)).toBeCloseTo(35);
  });
  it('ignore les valeurs invalides', () => {
    expect(soundTargetSec(NaN, -5, 30)).toBe(0);
  });
});

describe('needsResync', () => {
  it('tolère une petite dérive', () => {
    expect(needsResync(10.1, 10, 30)).toBe(false);
  });
  it('recale au-delà de la tolérance', () => {
    expect(needsResync(11, 10, 30)).toBe(true);
  });
  it('tient compte de la boucle', () => {
    expect(needsResync(29.9, 0.1, 30)).toBe(false);
  });
  it('recale après un retour au début de la vidéo', () => {
    expect(needsResync(14, 0.2, 30)).toBe(true);
  });
});

describe('clampSoundOffsetMs', () => {
  it('borne entre 0 et durée − 1 s', () => {
    expect(clampSoundOffsetMs(-3000, 30000)).toBe(0);
    expect(clampSoundOffsetMs(45000, 30000)).toBe(29000);
    expect(clampSoundOffsetMs(12000, null)).toBe(12000);
  });
});

describe('formatSoundTime', () => {
  it('formate en m:ss', () => {
    expect(formatSoundTime(65000)).toBe('1:05');
    expect(formatSoundTime(0)).toBe('0:00');
  });
});

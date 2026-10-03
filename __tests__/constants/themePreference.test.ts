import { restoredThemeId, THEME_IDS } from '@/constants/themes';

describe('Galerie vivante preference rollout', () => {
  it('introduces the chosen identity on first launch and for the former default', () => {
    expect(restoredThemeId(null, false)).toBe('gallery');
    expect(restoredThemeId('original', false)).toBe('gallery');
  });
  it('preserves every explicit alternative at upgrade', () => {
    for (const id of THEME_IDS.filter(id => id !== 'original')) {
      expect(restoredThemeId(id, false)).toBe(id);
    }
  });
  it('lets users return to Original without resetting it on the next launch', () => {
    expect(restoredThemeId('original', true)).toBe('original');
  });
  it('recovers an invalid stored preference with the new default', () => {
    expect(restoredThemeId('unknown', true)).toBe('gallery');
  });
});

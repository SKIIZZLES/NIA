/**
 * Rendu de la pastille « First » : visible seulement pour un rang 1..100,
 * libellé « First », accessibilité en français (« vous » sur son profil),
 * ton sombre ou clair selon le thème d'Apparence.
 */
import React from 'react';
import { Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { FirstBadge, type FirstBadgeProps } from '@/components/FirstBadge';
import { PaletteScope } from '@/context/ThemeContext';
import { FIRST_BADGE_PALETTES } from '@/constants/firstBadge';
import { THEME_IDS, resolveThemeColors, type ThemeColors } from '@/constants/themes';
import { resetFirstBadges, setFirstBadgeRows } from '@/lib/firstBadge';
import { APP_LOCALES, setI18nLocale, t as translate } from '@/lib/i18n';

jest.mock('@/lib/supabase', () => ({ getSupabase: () => null, isSupabaseConfigured: false }));
jest.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (scope: string, options?: Record<string, string | number>) =>
      jest.requireActual('@/lib/i18n').t(scope, options),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: ReactTestRenderer[] = [];

function render(props: FirstBadgeProps, colors?: ThemeColors): ReactTestRenderer {
  let r!: ReactTestRenderer;
  const el = <FirstBadge {...props} />;
  act(() => {
    r = TestRenderer.create(colors ? <PaletteScope palette={colors}>{el}</PaletteScope> : el);
  });
  mounted.push(r);
  return r;
}

function pill(r: ReactTestRenderer) {
  return r.root.findAll((n) => n.type === View && n.props.testID === 'first-badge')[0];
}

function flat(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === 'object') Object.assign(out, s);
  };
  walk(style);
  return out;
}

beforeEach(() => {
  setI18nLocale('fr');
  resetFirstBadges();
});

afterEach(() => {
  act(() => {
    while (mounted.length) mounted.pop()!.unmount();
  });
});

describe('FirstBadge', () => {
  it('ne rend rien pour un compte sans rang', () => {
    const r = render({ userId: 'inconnu', username: '@personne' });
    expect(r.toJSON()).toBeNull();
  });

  it('ne rend rien pour un rang hors 1..100', () => {
    for (const rank of [0, 101, null]) {
      expect(render({ rank }).toJSON()).toBeNull();
    }
  });

  it('affiche « First » pour un compte classé (par identifiant)', () => {
    setFirstBadgeRows([{ id: 'u1', username: 'karamba.gassama', first_rank: 1 }]);
    const r = render({ userId: 'u1' });
    const p = pill(r);
    expect(p).toBeTruthy();
    expect(r.root.findByType(Text).props.children).toBe('First');
    expect(p.props.accessible).toBe(true);
    expect(p.props.accessibilityLabel).toBe('Badge First : l’un des 100 premiers comptes de NIA');
  });

  it('retrouve le compte par @pseudo (cartes du fil)', () => {
    setFirstBadgeRows([{ id: 'u2', username: 'awa.k', first_rank: 12 }]);
    expect(pill(render({ username: '@Awa.K' }))).toBeTruthy();
  });

  it('suit l’annuaire quand il arrive après le premier rendu', () => {
    const r = render({ userId: 'u3' });
    expect(r.toJSON()).toBeNull();
    act(() => setFirstBadgeRows([{ id: 'u3', username: 'kofi', first_rank: 3 }]));
    expect(pill(r)).toBeTruthy();
  });

  it('sur son profil, le libellé d’accessibilité vouvoie', () => {
    const p = pill(render({ rank: 5, own: true }));
    expect(p.props.accessibilityLabel).toBe(
      'Badge First : vous faites partie des 100 premiers comptes de NIA',
    );
  });

  it('peut afficher le rang (« First #12 ») pour plus tard', () => {
    const r = render({ rank: 12, showRank: true });
    expect(r.root.findByType(Text).props.children).toBe('First #12');
    expect(pill(r).props.accessibilityLabel).toBe(
      'Badge First, n° 12 : l’un des 100 premiers comptes de NIA',
    );
  });

  it('prend le ton du thème : sombre partout, clair pour Clair ; `dark` force le sombre', () => {
    for (const id of THEME_IDS) {
      for (const scheme of ['dark', 'light'] as const) {
        const c = resolveThemeColors(id, scheme);
        const expected = c.isDark ? FIRST_BADGE_PALETTES.dark : FIRST_BADGE_PALETTES.light;
        const p = pill(render({ rank: 1 }, c));
        expect(flat(p.props.style).backgroundColor).toBe(expected.background);
        expect(flat(p.props.style).borderColor).toBe(expected.border);
        const forced = pill(render({ rank: 1, variant: 'dark' }, c));
        expect(flat(forced.props.style).backgroundColor).toBe(FIRST_BADGE_PALETTES.dark.background);
      }
    }
  });

  it('libellé « First » et clés d’accessibilité présents dans les 20 langues', () => {
    // Le contrôle de parité des clés est dans __tests__/locales ; ici, le sens :
    // le libellé de marque reste « First » partout.
    for (const loc of APP_LOCALES) {
      setI18nLocale(loc);
      expect(translate('badge.first')).toBe('First');
      expect(translate('badge.firstA11y')).toMatch(/First/);
      expect(translate('badge.firstA11y')).toMatch(/100/);
      expect(translate('badge.firstRank', { rank: 7 })).toBe('First #7');
    }
    setI18nLocale('fr');
  });
});

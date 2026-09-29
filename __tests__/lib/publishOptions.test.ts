import {
  DEFAULT_PUBLISH_OPTIONS,
  MAX_ALT_TEXT,
  applyMention,
  canRepostItem,
  currentMentionToken,
  hasRestrictiveOptions,
  isMissingPublishOptionsColumn,
  publishOptionsPayload,
} from '@/lib/publishOptions';

describe('publishOptionsPayload', () => {
  it('par défaut : public, commentaires et reposts autorisés', () => {
    expect(publishOptionsPayload(DEFAULT_PUBLISH_OPTIONS, null)).toEqual({
      visibility: 'public',
      allow_comments: true,
      allow_reuse: true,
      ai_generated: false,
      alt_text: null,
      location_text: null,
      edit_meta: null,
    });
  });

  it('une publication non publique n’est jamais republiable', () => {
    const p = publishOptionsPayload({ ...DEFAULT_PUBLISH_OPTIONS, visibility: 'followers' }, null);
    expect(p.allow_reuse).toBe(false);
  });

  it('nettoie et coupe le texte alternatif et le lieu', () => {
    const p = publishOptionsPayload(
      { ...DEFAULT_PUBLISH_OPTIONS, altText: `  ${'a'.repeat(600)} `, locationText: '  Dakar \n Sénégal ' },
      null,
    );
    expect((p.alt_text as string).length).toBe(MAX_ALT_TEXT);
    expect(p.location_text).toBe('Dakar Sénégal');
  });
});

describe('hasRestrictiveOptions', () => {
  it('détecte les choix impossibles à honorer sans 016', () => {
    expect(hasRestrictiveOptions(DEFAULT_PUBLISH_OPTIONS)).toBe(false);
    expect(hasRestrictiveOptions({ ...DEFAULT_PUBLISH_OPTIONS, aiGenerated: true, altText: 'x' })).toBe(false);
    expect(hasRestrictiveOptions({ ...DEFAULT_PUBLISH_OPTIONS, visibility: 'private' })).toBe(true);
    expect(hasRestrictiveOptions({ ...DEFAULT_PUBLISH_OPTIONS, allowComments: false })).toBe(true);
    expect(hasRestrictiveOptions({ ...DEFAULT_PUBLISH_OPTIONS, allowReuse: false })).toBe(true);
  });
});

describe('isMissingPublishOptionsColumn', () => {
  it('reconnaît l’erreur PostgREST de colonne absente', () => {
    expect(
      isMissingPublishOptionsColumn({
        code: 'PGRST204',
        message: "Could not find the 'visibility' column of 'videos' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingPublishOptionsColumn({ code: '42703', message: 'column videos.edit_meta does not exist' }),
    ).toBe(true);
  });

  it('ignore les autres erreurs', () => {
    expect(isMissingPublishOptionsColumn(null)).toBe(false);
    expect(isMissingPublishOptionsColumn({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isMissingPublishOptionsColumn({ code: '42703', message: 'column videos.foo does not exist' })).toBe(false);
  });
});

describe('canRepostItem', () => {
  it('public et réutilisable uniquement', () => {
    expect(canRepostItem({})).toBe(true);
    expect(canRepostItem({ visibility: 'public', allowReuse: true })).toBe(true);
    expect(canRepostItem({ visibility: 'public', allowReuse: false })).toBe(false);
    expect(canRepostItem({ visibility: 'followers' })).toBe(false);
    expect(canRepostItem({ visibility: 'private', allowReuse: true })).toBe(false);
  });
});

describe('suggestions #/@', () => {
  it('trouve le mot en cours', () => {
    expect(currentMentionToken('Salut #Dak')).toEqual({ kind: '#', query: 'dak', start: 6, end: 10 });
    expect(currentMentionToken('avec @')).toEqual({ kind: '@', query: '', start: 5, end: 6 });
    expect(currentMentionToken('mail@exemple')).toBeNull();
    expect(currentMentionToken('fini #dakar ')).toBeNull();
  });

  it('tient compte du curseur', () => {
    expect(currentMentionToken('#dak suite', 4)).toEqual({ kind: '#', query: 'dak', start: 0, end: 4 });
  });

  it('remplace le mot par la suggestion', () => {
    const text = 'Salut #Dak';
    const tok = currentMentionToken(text)!;
    expect(applyMention(text, tok, 'dakar')).toEqual({ text: 'Salut #dakar ', cursor: 13 });
    const mid = '#da suite';
    expect(applyMention(mid, currentMentionToken(mid, 3)!, 'dakar')).toEqual({
      text: '#dakar suite',
      cursor: 7,
    });
  });
});

/**
 * Plugin de config : Snapchat déclaré dans les <queries> Android (spike).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addSnapchatQueries } = require('../../plugins/withSnapchatQueries');

type Manifest = {
  queries?: {
    package?: { $: Record<string, string> }[];
    intent?: { action: { $: Record<string, string> }[]; data: { $: Record<string, string> }[] }[];
  }[];
};

describe('withSnapchatQueries', () => {
  it('ajoute le paquet et le scheme snapchat', () => {
    const m: Manifest = addSnapchatQueries({});
    expect(m.queries?.[0].package).toEqual([{ $: { 'android:name': 'com.snapchat.android' } }]);
    expect(m.queries?.[0].intent?.[0].data).toEqual([{ $: { 'android:scheme': 'snapchat' } }]);
    expect(m.queries?.[0].intent?.[0].action).toEqual([
      { $: { 'android:name': 'android.intent.action.VIEW' } },
    ]);
  });

  it('est idempotent et garde les requêtes existantes', () => {
    const start: Manifest = {
      queries: [{ package: [{ $: { 'android:name': 'com.other' } }] }],
    };
    const once = addSnapchatQueries(start);
    const twice: Manifest = addSnapchatQueries(once);
    expect(twice.queries).toHaveLength(1);
    expect(twice.queries?.[0].package?.map((p) => p.$['android:name'])).toEqual([
      'com.other',
      'com.snapchat.android',
    ]);
    expect(twice.queries?.[0].intent).toHaveLength(1);
  });
});

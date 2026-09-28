/**
 * Doubles des modules natifs que jest-expo ne fournit pas.
 *
 * `lib/supabase.ts` importe AsyncStorage et expo-secure-store au chargement du
 * module : sans ces doubles, tout test qui touche à `lib/videos.ts` échoue à
 * l'import, avant d'avoir exécuté une seule assertion.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

/**
 * Key-value stores for preferences: {getItem(key), setItem(key, value)}.
 *
 * localStore is the browser's localStorage, looked up on each call so a
 * blocked store throws at the call (persist.js catches it) rather than at
 * import. memoryStore keeps values for the page's life only — the demo
 * uses it so a visitor's clicks never write to their browser.
 */
export const localStore = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

export function createMemoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

export const memoryStore = createMemoryStore();

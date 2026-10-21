/** Defer profile requests until Supabase releases its auth-event lock. */
export function deferredAuthState<T>(
  apply: (session: T, isCurrent: () => boolean) => Promise<void>,
) {
  let revision = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    onSession(session: T): void {
      if (disposed) return;
      const current = ++revision;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void apply(session, () => !disposed && current === revision);
      }, 0);
    },
    dispose(): void {
      disposed = true;
      ++revision;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

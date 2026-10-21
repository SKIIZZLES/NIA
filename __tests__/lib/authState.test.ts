import { deferredAuthState } from '@/lib/authState';

describe('auth event scheduling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns before profile work begins, releasing the auth lock', () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const state = deferredAuthState(apply);
    expect(state.onSession('signed-in')).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(apply).toHaveBeenCalledWith('signed-in', expect.any(Function));
    state.dispose();
  });

  it('invalidates a pending profile when sign-out arrives', async () => {
    const committed: string[] = [];
    let resolve!: () => void;
    const profile = new Promise<void>((done) => { resolve = done; });
    const state = deferredAuthState<string | null>(async (session, isCurrent) => {
      if (session) await profile;
      if (isCurrent()) committed.push(session ?? 'signed-out');
    });
    state.onSession('old-user');
    jest.runAllTimers();
    state.onSession(null);
    jest.runAllTimers();
    resolve();
    await Promise.resolve();
    expect(committed).toEqual(['signed-out']);
    state.dispose();
  });

  it('cancels queued work when the provider unmounts', () => {
    const apply = jest.fn().mockResolvedValue(undefined);
    const state = deferredAuthState(apply);
    state.onSession('user');
    state.dispose();
    state.onSession('another-user');
    jest.runAllTimers();
    expect(apply).not.toHaveBeenCalled();
  });
});

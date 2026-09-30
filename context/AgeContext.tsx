/**
 * Âge déclaré et choix « Afficher les contenus 18+ » (migration 020).
 *
 * Charge l'état à chaque changement de compte. Si la date a été saisie à
 * l'inscription (avant la confirmation de l'e-mail), elle est envoyée ici à
 * la première session du compte, sans redemander.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  UNSUPPORTED_AGE_STATUS,
  declareBirthDate,
  fetchMyAgeStatus,
  markAgeRefused,
  setMatureOptIn,
  takePendingBirthDate,
  type AgeStatus,
  type DeclareResult,
  type OptInResult,
} from '@/lib/age';

type AgeContextValue = {
  status: AgeStatus;
  /** true tant que l'état du compte courant n'est pas chargé. */
  loading: boolean;
  refresh: () => Promise<void>;
  declare: (iso: string) => Promise<DeclareResult>;
  setShowMature: (on: boolean) => Promise<OptInResult>;
};

const AgeContext = createContext<AgeContextValue | null>(null);

export function AgeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<AgeStatus>(UNSUPPORTED_AGE_STATUS);
  const [loading, setLoading] = useState(false);
  const userKey = user?.id ?? null;
  const email = user?.email ?? null;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!userKey) {
      setStatus(UNSUPPORTED_AGE_STATUS);
      setLoading(false);
      return;
    }
    setLoading(true);
    let next = await fetchMyAgeStatus();
    if (next.supported && !next.declared) {
      const pending = await takePendingBirthDate(email);
      if (pending) {
        const r = await declareBirthDate(pending);
        if (!r.ok && r.tooYoung) await markAgeRefused();
        next = await fetchMyAgeStatus();
      }
    }
    if (mine !== seq.current) return;
    setStatus(next);
    setLoading(false);
  }, [userKey, email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const declare = useCallback(
    async (iso: string) => {
      const r = await declareBirthDate(iso);
      if (!r.ok && r.tooYoung) await markAgeRefused();
      if (r.ok || !r.tooYoung) await refresh();
      return r;
    },
    [refresh],
  );

  const setShowMature = useCallback(
    async (on: boolean) => {
      const r = await setMatureOptIn(on);
      if (r.ok) setStatus((s) => ({ ...s, showMature: s.adult && r.on }));
      return r;
    },
    [],
  );

  const value = useMemo(
    () => ({ status, loading, refresh, declare, setShowMature }),
    [status, loading, refresh, declare, setShowMature],
  );

  return <AgeContext.Provider value={value}>{children}</AgeContext.Provider>;
}

export function useAge(): AgeContextValue {
  const ctx = useContext(AgeContext);
  if (!ctx) throw new Error('useAge doit être utilisé dans AgeProvider');
  return ctx;
}

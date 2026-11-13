import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useMemberAuth } from './memberAuth';
import { createRecentWorksStore, type RecentWorksStore } from './recentWorks';

const RecentWorksContext = createContext<RecentWorksStore | null>(null);

/** 현재 서버·회원 범위에 속하는 최근 본 목록을 화면들이 공유합니다. */
export function RecentWorksProvider({ children }: { children: ReactNode }) {
  const { client } = useMemberAuth();
  const store = useMemo(() => createRecentWorksStore(client), [client]);
  useEffect(() => { store.start(); return () => store.dispose(); }, [store]);
  return <RecentWorksContext.Provider value={store}>{children}</RecentWorksContext.Provider>;
}

/** 최근 본 목록과 공통 기록·새로고침 동작을 읽습니다. */
export function useRecentWorks() {
  const store = useContext(RecentWorksContext);
  if (!store) throw new Error('RecentWorksProvider가 필요합니다.');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { state, record: store.record, refresh: store.refresh, clearGuest: store.clearGuest };
}

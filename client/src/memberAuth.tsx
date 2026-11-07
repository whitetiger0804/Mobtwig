import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useApiUrl } from './serverConnection';
import { createMemberSessionClient, type MemberSessionClient, type MemberAuthState } from './memberSession';

/** 화면에서 사용하는 현재 인증 상태와 동작입니다. */
export interface MemberAuthValue {
  /** 서버에서 확인한 현재 회원과 요청 세대입니다. */
  state: Readonly<MemberAuthState>;
  /** 플랫폼 쿠키로 인증을 수행하는 클라이언트입니다. */
  client: MemberSessionClient;
}

/** 현재 서버에만 속하는 메모리 전용 세션 클라이언트입니다. */
const MemberContext = createContext<MemberSessionClient | null>(null);

/**
 * 앱 시작과 foreground 복귀 시 서버의 세션을 확인합니다.
 * @param props - 인증 상태를 공유할 하위 화면입니다.
 * @returns 회원 인증 공급자입니다.
 */
export function MemberAuthProvider({ children }: {
  /** 현재 서버와 회원 상태를 공유할 요소입니다. */
  children: ReactNode;
}) {
  const url = useApiUrl();
  const client = useMemo(() => createMemberSessionClient(url), [url]);
  useEffect(() => {
    void client.refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void client.refresh(); });
    return () => { subscription.remove(); client.dispose(); };
  }, [client]);
  return <MemberContext.Provider value={client}>{children}</MemberContext.Provider>;
}

/**
 * 현재 인증 상태와 서버에서 확인하는 동작을 읽습니다.
 * @returns 상태와 로그인·로그아웃·재확인 클라이언트입니다.
 */
export function useMemberAuth(): MemberAuthValue {
  const client = useContext(MemberContext);
  if (!client) throw new Error('MemberAuthProvider가 필요합니다.');
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return { state, client };
}

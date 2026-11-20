import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { observeWorkLinks } from './workLinks';

type Target = { workId: string | null; sequence: number };
const WorkLinkContext = createContext<{ ready: boolean; target: Target | null }>({ ready: false, target: null });

/** 서버 선택과 인증 초기화 중에도 앱에 들어오는 작품 링크를 보관합니다. */
export function WorkLinkProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; target: Target | null }>({ ready: false, target: null });
  useEffect(() => observeWorkLinks(Linking, target => setState({ ready: true, target }),
    process.env.EXPO_PUBLIC_SHARE_BASE_URL), []);
  return <WorkLinkContext.Provider value={state}>{children}</WorkLinkContext.Provider>;
}

/** 가장 최근에 받은 작품 링크와 초기 URL의 처리 완료 여부입니다. */
export function useWorkLink() { return useContext(WorkLinkContext); }

import type { MemberAuthState, MemberSessionClient } from './memberSession.ts';
import type { WorkDetail } from './workDetails.ts';

/** 최근 본 작품 한 건이며 lastReadAt은 마지막으로 연 UTC 시각입니다. */
export interface RecentWork {
  id: string;
  title: string;
  imageUrl: string;
  kind: 'book' | 'novel' | 'magazine';
  lastReadAt: string;
}

const invalid = () => new Error('최근 본 작품 응답을 확인할 수 없습니다.');

/**
 * 서버 응답이 최근 본 작품 목록 형식인지 검사합니다.
 * @param value - 미검증 응답입니다.
 * @returns 검사를 통과한 목록입니다.
 */
export function parseRecentWorks(value: unknown): RecentWork[] {
  if (!Array.isArray(value)) throw invalid();
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object') throw invalid();
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)
        || typeof r.title !== 'string' || !r.title.trim()
        || typeof r.imageUrl !== 'string' || !r.imageUrl
        || (r.kind !== 'book' && r.kind !== 'novel' && r.kind !== 'magazine')
        || typeof r.lastReadAt !== 'string' || !Number.isFinite(Date.parse(r.lastReadAt))) throw invalid();
    seen.add(r.id);
    return { id: r.id, title: r.title, imageUrl: r.imageUrl, kind: r.kind, lastReadAt: r.lastReadAt };
  });
}

/**
 * 현재 회원의 최근 본 작품을 읽습니다.
 * @param client - 현재 회원 세션입니다.
 * @returns 최근 본 순서의 작품 목록입니다.
 */
export async function readRecentWorks(client: MemberSessionClient): Promise<RecentWork[]> {
  return parseRecentWorks(await client.request('/api/members/recent-works'));
}
/**
 * 현재 회원이 작품을 열었음을 서버에 기록합니다.
 * @param client - 현재 회원 세션입니다.
 * @param slug - 연 작품의 식별자입니다.
 */
export async function recordRecentWork(client: MemberSessionClient, slug: string): Promise<void> {
  await client.request(`/api/members/recent-works/${encodeURIComponent(slug)}`, { method: 'POST' });
}

/** 홈과 전용 화면이 함께 사용하는 최근 본 목록의 현재 상태입니다. */
export interface RecentWorksState {
  status: 'loading' | 'ready' | 'error';
  items: readonly RecentWork[];
  authenticated: boolean;
  error: string | null;
}

/** 회원 세션 범위에 속하는 최근 본 목록과 갱신 동작입니다. */
export interface RecentWorksStore {
  getSnapshot(): Readonly<RecentWorksState>;
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  refresh(): Promise<void>;
  record(work: Pick<WorkDetail, 'id' | 'title' | 'imageUrl' | 'kind'>): Promise<void>;
  clearGuest(): void;
}

/**
 * 비회원 메모리와 회원 API를 현재 인증 범위에 맞춰 관리합니다.
 * 계정 변경 전 요청의 응답은 새 목록에 반영하지 않습니다.
 * @param client - 현재 서버의 회원 세션 클라이언트입니다.
 * @returns 홈·상세·최근 본 화면에서 공유할 저장소입니다.
 */
export function createRecentWorksStore(client: MemberSessionClient): RecentWorksStore {
  let auth = client.getSnapshot();
  let state: Readonly<RecentWorksState> = initial(auth);
  let active = false, epoch = 0, readSequence = 0;
  let unsubscribe = () => {};
  let reading: Promise<void> | null = null;
  let writing = Promise.resolve();
  const listeners = new Set<() => void>();

  function initial(value: Readonly<MemberAuthState>): RecentWorksState {
    return { status: value.status === 'anonymous' ? 'ready' : value.status === 'error' ? 'error' : 'loading',
      items: [], authenticated: value.status === 'authenticated', error: value.error };
  }
  function publish(next: RecentWorksState) {
    state = next;
    for (const listener of listeners) listener();
  }
  const current = (owner: number) => active && owner === epoch;
  const message = (reason: unknown) => reason instanceof Error ? reason.message : '최근 본 작품을 처리하지 못했습니다.';

  function refresh(): Promise<void> {
    if (!active) return Promise.resolve();
    if (auth.status === 'error') return client.refresh().then(() => reading ?? Promise.resolve());
    if (auth.status !== 'authenticated') return Promise.resolve();
    if (reading) return reading;
    const owner = epoch, sequence = ++readSequence;
    publish({ ...state, status: 'loading', error: null });
    reading = readRecentWorks(client).then(items => {
      if (current(owner) && sequence === readSequence) {
        publish({ status: 'ready', items, authenticated: true, error: null });
      }
    }, reason => {
      if (current(owner) && sequence === readSequence) {
        publish({ status: 'error', items: [], authenticated: true, error: message(reason) });
      }
    }).finally(() => {
      if (current(owner) && sequence === readSequence) reading = null;
    });
    return reading;
  }

  function synchronize(force = false) {
    const next = client.getSnapshot();
    if (!force && next.status === auth.status && next.generation === auth.generation && next.member?.id === auth.member?.id) return;
    auth = next;
    epoch++; readSequence++;
    reading = null;
    writing = Promise.resolve();
    publish(initial(auth));
    if (auth.status === 'authenticated') void refresh();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() { active = true; unsubscribe = client.subscribe(synchronize); synchronize(true); },
    dispose() { active = false; epoch++; unsubscribe(); },
    refresh,
    record(work) {
      if (!active) return Promise.resolve();
      if (auth.status === 'anonymous') {
        const item: RecentWork = { id: work.id, title: work.title, imageUrl: work.imageUrl, kind: work.kind,
          lastReadAt: new Date().toISOString() };
        publish({ status: 'ready', items: [item, ...state.items.filter(value => value.id !== item.id)].slice(0, 20),
          authenticated: false, error: null });
        return Promise.resolve();
      }
      if (auth.status !== 'authenticated') return Promise.resolve();
      const owner = epoch;
      writing = writing.then(async () => {
        if (!current(owner)) return;
        try {
          await recordRecentWork(client, work.id);
          if (current(owner)) {
            readSequence++;
            reading = null;
            await refresh();
          }
        } catch (reason) {
          if (current(owner)) {
            readSequence++; reading = null;
            publish({ status: 'error', items: [], authenticated: true, error: message(reason) });
          }
        }
      });
      return writing;
    },
    clearGuest() {
      if (active && auth.status === 'anonymous') publish({ status: 'ready', items: [], authenticated: false, error: null });
    },
  };
}

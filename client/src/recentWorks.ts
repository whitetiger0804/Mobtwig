import type { MemberSessionClient } from './memberSession.ts';

/** 최근 본 작품 한 건입니다. (API 확정 전 가정한 모양) */
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
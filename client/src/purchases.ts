import { MemberRequestError, type MemberSessionClient } from './memberSession.ts';
import type { WorkKind } from './workDetails.ts';

// #region 상품과 구매 응답
/** 작품 전체 또는 웹소설 한 회차의 구매 상품입니다. */
export interface PurchaseProduct {
  productId: string;
  workId: string;
  kind: WorkKind;
  title: string;
  imageUrl: string;
  chapterId: string | null;
  chapterTitle: string | null;
  price: number;
  currency: 'KRW';
  owned: boolean;
  readable: boolean;
  paymentMode: 'DEMO';
}

/** 구매 당시 제목·표지·가격을 보존한 내역입니다. 목록 키는 purchaseId입니다. */
export interface PurchaseRecord extends Omit<PurchaseProduct, 'owned' | 'readable'> {
  purchaseId: string;
  purchasedAt: string;
}

/** 서버가 구매와 함께 등록한 서재의 작품입니다. */
interface LibraryWorkBase {
  id: string;
  title: string;
  imageUrl: string;
  libraryStatus: 'WANT_TO_READ' | 'READING' | 'COMPLETED';
  /** 저자 식별자 순서로 연결된 이름입니다. */
  author: string;
  /** 현재 회원이 마지막으로 저장한 공개 회차 번호이며 기록이 없으면 null입니다. */
  lastReadChapterNumber: number | null;
  /** 저장한 회차 뒤에 현재 공개된 회차가 있는지 나타냅니다. */
  hasNextChapter: boolean;
}

/** 작품 종류에 따라 통계 제공 여부가 결정되는 서재 작품입니다. */
export type LibraryWork = LibraryWorkBase & (
  | { kind: 'novel'; statistics: { views: number; recommendations: number; chapterCount: number } }
  | { kind: 'book' | 'magazine'; statistics: null }
);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
const kind = (value: unknown): value is WorkKind => value === 'book' || value === 'magazine' || value === 'novel';
const invalid = () => new Error('상품·구매 응답의 형식이 올바르지 않습니다.');
const canceled = () => Object.assign(new Error('이전 회원의 요청이 취소됐습니다.'), { name: 'AbortError' });

/** 화면에서 사용할 수 있는 표지 주소를 검사합니다. */
function imageUrl(value: unknown): boolean {
  if (!text(value) || /[\u0000-\u001f\\]/.test(value) || value.startsWith('//')
      || !(value.startsWith('/') || /^https?:\/\//i.test(value))) return false;
  try {
    const url = new URL(value, 'https://api.example.test');
    return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}

/** 상품과 구매 스냅샷의 공통 필드를 확인합니다. */
function validItem(value: unknown): value is Omit<PurchaseProduct, 'owned' | 'readable'> & Record<string, unknown> {
  if (!object(value) || !id(value.productId) || !slug(value.workId) || !kind(value.kind)
      || !text(value.title) || !imageUrl(value.imageUrl) || !Number.isInteger(value.price)
      || (value.price as number) < 0 || (value.price as number) > 2_147_483_647
      || value.currency !== 'KRW' || value.paymentMode !== 'DEMO') return false;
  return value.kind === 'novel'
    ? typeof value.chapterId === 'string' && /^-?[1-9][0-9]*$/.test(value.chapterId) && text(value.chapterTitle)
    : value.chapterId === null && value.chapterTitle === null;
}

/** 요청 작품의 상품만 받아들이며 실패 응답을 무료 상품으로 바꾸지 않습니다. */
export function parsePurchaseProducts(value: unknown, workId: string): PurchaseProduct[] {
  if (!Array.isArray(value)) throw invalid();
  const ids = new Set<string>(), targets = new Set<string | null>();
  for (const item of value) {
    if (!validItem(item) || item.workId !== workId || ids.has(item.productId) || targets.has(item.chapterId)
        || typeof item.owned !== 'boolean' || typeof item.readable !== 'boolean') throw invalid();
    ids.add(item.productId); targets.add(item.chapterId);
  }
  return value;
}

/** 구매 응답을 현재 가격이 아닌 구매 당시 스냅샷으로 검증합니다. */
export function parsePurchaseRecord(value: unknown): PurchaseRecord {
  if (!validItem(value) || !id(value.purchaseId) || !text(value.purchasedAt)
      || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(value.purchasedAt) || !Number.isFinite(Date.parse(value.purchasedAt))) throw invalid();
  return { ...value, purchaseId: value.purchaseId, purchasedAt: value.purchasedAt };
}
// #endregion

// #region 조회와 구매
/** 현재 회원이면 소장 상태를, 비회원이면 공개 상품을 조회합니다. */
export async function readPurchaseProducts(apiUrl: string, client: MemberSessionClient, workId: string, signal: AbortSignal): Promise<PurchaseProduct[]> {
  const owner = client.getSnapshot();
  const path = '/works/' + encodeURIComponent(workId) + '/purchase-products';
  let value: unknown;
  if (owner.status === 'authenticated') value = await client.request('/api/members' + path, { signal });
  else {
    const response = await fetch(apiUrl + path, { signal });
    if (!response.ok) throw new Error('상품 정보를 불러오지 못했습니다. (HTTP ' + response.status + ')');
    value = await response.json();
  }
  if (signal.aborted || client.getSnapshot().generation !== owner.generation) throw canceled();
  return parsePurchaseProducts(value, workId);
}

/** 회원 본인의 구매 내역이며 같은 작품의 여러 회차 구매를 유지합니다. */
export async function readPurchaseHistory(client: MemberSessionClient): Promise<PurchaseRecord[]> {
  const value = await client.request('/api/members/purchase-history');
  if (!Array.isArray(value)) throw invalid();
  const items = value.map(parsePurchaseRecord);
  if (new Set(items.map(item => item.purchaseId)).size !== items.length) throw invalid();
  return items;
}

/** 별도 등록 없이 서버가 관리하는 최신 서재를 조회합니다. */
export async function readMemberLibrary(client: MemberSessionClient, selectedKind: WorkKind | 'all'): Promise<LibraryWork[]> {
  const value = await client.request('/api/members/library?kind=' + selectedKind);
  if (!Array.isArray(value)) throw new Error('서재 응답의 형식이 올바르지 않습니다.');
  const ids = new Set<string>();
  for (const item of value) {
    if (!object(item) || !slug(item.id) || ids.has(item.id) || !text(item.title) || !text(item.author) || !imageUrl(item.imageUrl)
        || !kind(item.kind) || selectedKind !== 'all' && item.kind !== selectedKind
        || !['WANT_TO_READ', 'READING', 'COMPLETED'].includes(item.libraryStatus as string)
        || !(item.lastReadChapterNumber === null || Number.isInteger(item.lastReadChapterNumber)
          && (item.lastReadChapterNumber as number) >= 1 && (item.lastReadChapterNumber as number) <= 2_147_483_647)
        || typeof item.hasNextChapter !== 'boolean'
        || !(item.kind === 'novel' ? object(item.statistics)
          && [item.statistics.views, item.statistics.recommendations, item.statistics.chapterCount]
            .every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
          : item.statistics === null)) throw new Error('서재 응답의 형식이 올바르지 않습니다.');
    ids.add(item.id);
  }
  return value as LibraryWork[];
}

type Attempt = { product: PurchaseProduct; requestId: string; running: Promise<PurchaseRecord> | null };
const pending = new WeakMap<MemberSessionClient, { generation: number; attempts: Map<string, Attempt> }>();

/**
 * 결과가 불확실한 구매는 화면 재진입 후에도 같은 회원·상품의 UUID와 가격으로 재시도합니다.
 * @param client - 현재 회원의 세션과 CSRF를 관리하는 클라이언트입니다.
 * @param product - 화면에서 확인한 상품과 가격입니다.
 * @param newRequestId - 새 구매에만 호출하는 UUID 생성 함수입니다.
 * @returns 서버가 확인한 최초 구매 또는 같은 요청의 기존 구매입니다.
 * @throws Error 구매 실패·응답 불일치·회원 전환 시 발생합니다.
 */
export function purchaseProduct(client: MemberSessionClient, product: PurchaseProduct, newRequestId: () => string): Promise<PurchaseRecord> {
  const owner = client.getSnapshot();
  if (owner.status !== 'authenticated') return Promise.reject(new MemberRequestError(401, null));
  let session = pending.get(client);
  if (!session || session.generation !== owner.generation) {
    session = { generation: owner.generation, attempts: new Map() };
    pending.set(client, session);
  }
  const attempts = session.attempts;
  let attempt = attempts.get(product.productId);
  if (!attempt) {
    attempt = { product: { ...product }, requestId: newRequestId(), running: null };
    attempts.set(product.productId, attempt);
  }
  if (attempt.running) return attempt.running;
  const current = attempt;
  current.running = (async () => {
    try {
      const value = await client.request('/api/members/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: current.product.productId, expectedPrice: current.product.price, requestId: current.requestId }) });
      if (client.getSnapshot().generation !== owner.generation) throw canceled();
      const record = parsePurchaseRecord(value);
      if (record.productId !== current.product.productId || record.price !== current.product.price) throw invalid();
      attempts.delete(product.productId);
      return record;
    } catch (failure) {
      if (failure instanceof MemberRequestError && failure.status < 500 && ![408, 429].includes(failure.status)) attempts.delete(product.productId);
      throw failure;
    } finally { current.running = null; }
  })();
  return current.running;
}
// #endregion

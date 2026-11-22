// #region 로컬 초안 저장 범위
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';
import { parseCommunityDraftInput, type CommunityPostInput } from './community.ts';

/** 같은 기기에서도 서버·회원·게시판마다 초안을 따로 보관하는 범위입니다. */
export interface CommunityDraftScope {
  /** 현재 연결한 API의 기준 주소입니다. */
  apiUrl: string;
  /** 로그인한 회원의 식별자입니다. */
  memberId: string;
  /** 글쓰기 화면으로 들어온 게시판의 식별자입니다. */
  boardId: string;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^-?[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n;

/** API의 마지막 슬래시 차이를 정리하고 계정·게시판 경계가 섞이지 않는 저장 키를 만듭니다. */
function storageKey(scope: CommunityDraftScope): string {
  if (!isId(scope.memberId) || !isId(scope.boardId)) throw new Error('초안을 저장할 회원과 게시판을 확인해 주십시오.');
  const api = new URL(scope.apiUrl);
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash) {
    throw new Error('초안을 저장할 서버 주소를 확인해 주십시오.');
  }
  return 'mobtwig:community-draft:v1:' + JSON.stringify([api.href.replace(/\/+$/, ''), scope.memberId, scope.boardId]);
}

/** 작성 입력을 검증하되 로컬 초안에서는 사용자가 입력한 공백과 줄바꿈을 유지합니다. */
function parseDraft(value: unknown, boardId: string): CommunityPostInput {
  const parsed = parseCommunityDraftInput(value);
  if (parsed.boardId !== boardId) throw new Error('다른 게시판의 초안을 불러오거나 저장할 수 없습니다.');
  const original = value as CommunityPostInput;
  return { ...parsed, title: original.title, body: original.body };
}
// #endregion

// #region 기기 저장과 복원
/**
 * 현재 회원이 해당 게시판에서 저장한 로컬 초안을 읽습니다.
 * @param storage - 현재 기기의 문자열 저장소입니다.
 * @param scope - 서버 주소와 로그인한 회원·게시판 식별자입니다.
 * @returns 저장한 입력이며, 해당 범위의 초안이 없으면 null입니다.
 * @throws Error - 저장소 읽기 또는 저장값 검증에 실패하면 발생하며 원본 초안을 삭제하지 않습니다.
 */
export async function loadLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'getItem'>,
  scope: CommunityDraftScope): Promise<CommunityPostInput | null> {
  const saved = await storage.getItem(storageKey(scope));
  return saved === null ? null : parseDraft(JSON.parse(saved), scope.boardId);
}

/**
 * 해당 게시판의 초안만 기기에 저장하며 다른 게시판의 초안은 변경하지 않습니다.
 * @param storage - 현재 기기의 문자열 저장소입니다.
 * @param scope - 서버 주소와 로그인한 회원·게시판 식별자입니다.
 * @param input - 제목·본문·말머리·첨부·스포일러를 포함한 현재 작성 입력입니다.
 * @returns 기기 저장이 완료된 입력의 사본입니다.
 * @throws Error - 범위·입력 검증 또는 기기 저장에 실패하면 발생합니다.
 */
export async function saveLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'setItem'>,
  scope: CommunityDraftScope, input: CommunityPostInput): Promise<CommunityPostInput> {
  const key = storageKey(scope);
  const saved = parseDraft(input, scope.boardId);
  await storage.setItem(key, JSON.stringify(saved));
  return saved;
}

/**
 * 현재 회원의 해당 게시판 초안만 삭제합니다.
 * @param storage - 현재 기기의 문자열 저장소입니다.
 * @param scope - 삭제할 초안의 서버·회원·게시판 범위입니다.
 * @returns 기기에서 삭제가 완료되면 이행됩니다.
 * @throws Error - 범위 검증 또는 기기 삭제에 실패하면 발생합니다.
 */
export function deleteLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'removeItem'>,
  scope: CommunityDraftScope): Promise<void> {
  return storage.removeItem(storageKey(scope));
}
// #endregion

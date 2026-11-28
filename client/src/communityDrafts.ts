// #region 로컬 초안 저장 범위
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';
import { parseCommunityDraftInput, type CommunityPostInput, type CommunityBoard, type CommunitySticker } from './community.ts';

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
/** 읽거나 저장한 정확한 초안 버전입니다. 삭제 재시도가 이후 저장한 초안을 지우지 않게 사용합니다. */
export interface CommunityDraftSnapshot {
  input: CommunityPostInput;
  token: string;
}

// 같은 JS 실행 환경에서 비교·삭제와 저장이 서로 끼어들지 않도록 해당 저장 키의 작업만 순서대로 처리합니다.
const pending = new Map<string, Promise<unknown>>();
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
  return result;
}

function snapshot(raw: string, boardId: string): CommunityDraftSnapshot {
  const value = JSON.parse(raw);
  const input = value?.version === 2 ? value.input : value;
  return { input: parseDraft(input, boardId), token: raw };
}

/** 원본 버전을 함께 읽습니다. 과거 v1 입력도 수정 없이 복원합니다. */
export function loadLocalCommunityDraftSnapshot(storage: Pick<AsyncStorageStatic, 'getItem'>,
  scope: CommunityDraftScope): Promise<CommunityDraftSnapshot | null> {
  return inspectLocalCommunityDraft(storage, scope).then(result => {
    if (result.invalidToken !== null) throw new Error('임시저장한 글의 형식이 올바르지 않습니다.');
    return result.snapshot;
  });
}

/** 손상된 값은 원문을 화면에 공개하지 않고 명시적 삭제에 필요한 버전만 남깁니다. */
export function inspectLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'getItem'>,
  scope: CommunityDraftScope): Promise<{ snapshot: CommunityDraftSnapshot | null; invalidToken: string | null }> {
  const key = storageKey(scope);
  return serial(key, async () => {
    const raw = await storage.getItem(key);
    if (raw === null) return { snapshot: null, invalidToken: null };
    try { return { snapshot: snapshot(raw, scope.boardId), invalidToken: null }; }
    catch { return { snapshot: null, invalidToken: raw }; }
  });
}

/** 같은 내용으로 다시 저장하더라도 이전 게시 요청의 정리 대상과 구분되는 버전을 부여합니다. */
export function saveLocalCommunityDraftSnapshot(storage: Pick<AsyncStorageStatic, 'setItem'>,
  scope: CommunityDraftScope, input: CommunityPostInput): Promise<CommunityDraftSnapshot> {
  const key = storageKey(scope), saved = parseDraft(input, scope.boardId);
  const token = JSON.stringify({ version: 2, revision: `${Date.now()}-${Math.random()}-${Math.random()}`, input: saved });
  return serial(key, async () => { await storage.setItem(key, token); return { input: saved, token }; });
}

/** 삭제에 실패했거나 다른 화면에서 새 버전을 저장했다면 그 초안을 보존합니다. */
export function deleteMatchingLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'getItem' | 'removeItem'>,
  scope: CommunityDraftScope, expected: Pick<CommunityDraftSnapshot, 'token'>): Promise<boolean> {
  const key = storageKey(scope);
  return serial(key, async () => {
    if (await storage.getItem(key) !== expected.token) return false;
    await storage.removeItem(key);
    return true;
  });
}

/** 원본을 자동 수정하지 않고 현재 게시판·말머리·이모티콘 규칙으로 복원 가능 여부를 확인합니다. */
export function validateCommunityDraftForBoard(input: CommunityPostInput, board: CommunityBoard,
  stickers: readonly CommunitySticker[]): CommunityPostInput {
  const draft = parseDraft(input, board.id);
  if (!board.heads.includes(draft.head) || board.type === 'work' && draft.workId !== board.work?.id
      || board.type === 'topic' && draft.workId !== null) {
    throw new Error('현재 게시판에서 사용할 수 없는 작품이나 말머리가 있는 초안입니다. 저장된 원본은 유지됩니다.');
  }
  if (draft.stickerIds.some(id => !stickers.some(item => item.id === id))) {
    throw new Error('현재 사용할 수 없는 이모티콘이 있는 초안입니다. 저장된 원본은 유지됩니다.');
  }
  return draft;
}
/**
 * 현재 회원이 해당 게시판에서 저장한 로컬 초안을 읽습니다.
 * @param storage - 현재 기기의 문자열 저장소입니다.
 * @param scope - 서버 주소와 로그인한 회원·게시판 식별자입니다.
 * @returns 저장한 입력이며, 해당 범위의 초안이 없으면 null입니다.
 * @throws Error - 저장소 읽기 또는 저장값 검증에 실패하면 발생하며 원본 초안을 삭제하지 않습니다.
 */
export async function loadLocalCommunityDraft(storage: Pick<AsyncStorageStatic, 'getItem'>,
  scope: CommunityDraftScope): Promise<CommunityPostInput | null> {
  return (await loadLocalCommunityDraftSnapshot(storage, scope))?.input ?? null;
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
  return (await saveLocalCommunityDraftSnapshot(storage, scope, input)).input;
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
  const key = storageKey(scope);
  return serial(key, () => storage.removeItem(key));
}
// #endregion

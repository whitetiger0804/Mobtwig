// #region 서재 탭 저장 계약
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';

/** 내 서재에서 선택하여 현재 기기에 기억하는 작품 분류입니다. */
export type LibraryTab = 'book' | 'magazine' | 'novel';

/** 계정과 관계없이 현재 기기에서 유지하는 마지막 서재 탭의 저장 키입니다. */
const storageKey = 'mobtwig:library-tab:v1';
// #endregion

// #region 기기 저장과 복원
/**
 * 마지막 서재 탭을 복원하며 선택 기록이 없으면 도서를 사용합니다.
 * @param storage - 기기의 문자열 저장소입니다.
 * @returns 저장된 도서·매거진·웹소설 탭입니다.
 * @throws Error - 저장소 접근에 실패하거나 지원하지 않는 탭이 저장되어 있으면 발생합니다.
 */
export async function loadLibraryTab(storage: Pick<AsyncStorageStatic, 'getItem'>): Promise<LibraryTab> {
  const saved = await storage.getItem(storageKey);
  if (saved === null) return 'book';
  if (saved === 'book' || saved === 'magazine' || saved === 'novel') return saved;
  throw new Error('저장된 서재 탭이 올바르지 않습니다.');
}

/**
 * 선택한 서재 탭을 다음 앱 실행에도 사용할 수 있도록 저장합니다.
 * @param storage - 기기의 문자열 저장소입니다.
 * @param tab - 마지막으로 선택한 서재 탭입니다.
 * @returns 기기 저장이 완료되면 이행됩니다.
 * @throws Error - 기기 저장에 실패하면 발생합니다.
 */
export function saveLibraryTab(storage: Pick<AsyncStorageStatic, 'setItem'>, tab: LibraryTab): Promise<void> {
  return storage.setItem(storageKey, tab);
}
// #endregion

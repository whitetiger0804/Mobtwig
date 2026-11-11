// #region 읽기 설정 계약
import type { AsyncStorageStatic } from '@react-native-async-storage/async-storage';

/** 현재 기기에 저장하여 다음 실행에도 적용하는 읽기 설정입니다. */
export interface ReadingPreferences {
  /** 독서 화면의 배경 테마입니다. */
  theme: '크림' | '연노랑' | '연회색' | '다크';
  /** 읽기 설정 화면에서 선택한 글꼴 이름입니다. */
  font: string;
  /** 글자 크기 단계이며 0부터 4까지 사용합니다. */
  size: number;
}

/** 처음 실행하는 기기에 적용하는 설정입니다. */
const defaultPreferences: ReadingPreferences = { theme: '크림', font: '기본 명조', size: 2 };
/** 현재 기기에서 공유하는 버전 1 읽기 설정의 저장 키입니다. */
const storageKey = 'mobtwig:reading-preferences:v1';
// #endregion

// #region 저장값 검증과 입출력
/**
 * 저장값이 현재 화면에서 지원하는 테마·글꼴·크기인지 검사합니다.
 * @param value - 저장소에서 읽거나 저장할 설정입니다.
 * @returns 검증된 세 속성만 포함하는 새 설정 객체입니다.
 * @throws Error - 설정의 형식이나 선택값이 올바르지 않으면 발생합니다.
 */
export function parseReadingPreferences(value: unknown): ReadingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('읽기 설정의 형식이 올바르지 않습니다.');
  }
  const preferences = value as Record<string, unknown>;
  if (!['크림', '연노랑', '연회색', '다크'].includes(preferences.theme as string)
      || !['기본 명조', '기본 고딕', '나눔명조', '나눔고딕', '고운바탕', '고운돋움', '함렛', '플렉스고딕'].includes(preferences.font as string)
      || typeof preferences.size !== 'number' || !Number.isInteger(preferences.size)
      || preferences.size < 0 || preferences.size > 4) {
    throw new Error('지원하지 않는 읽기 설정입니다.');
  }
  return {
    theme: preferences.theme as ReadingPreferences['theme'],
    font: preferences.font as string,
    size: preferences.size,
  };
}

/**
 * 기기에 저장한 설정을 복원하며 최초 실행에는 기본값을 사용합니다.
 * @param storage - 기기의 문자열 저장소입니다.
 * @returns 검증된 읽기 설정입니다.
 * @throws Error - 저장소 접근이나 저장된 JSON 검증에 실패하면 발생합니다.
 */
export async function loadReadingPreferences(storage: Pick<AsyncStorageStatic, 'getItem'>): Promise<ReadingPreferences> {
  const saved = await storage.getItem(storageKey);
  return saved === null ? { ...defaultPreferences } : parseReadingPreferences(JSON.parse(saved));
}

/**
 * 설정을 검증한 뒤 기기 저장이 완료된 값을 반환합니다.
 * @param storage - 기기의 문자열 저장소입니다.
 * @param preferences - 사용자가 적용할 설정입니다.
 * @returns 저장이 완료된 설정의 사본입니다.
 * @throws Error - 설정 검증이나 기기 저장에 실패하면 발생합니다.
 */
export async function saveReadingPreferences(storage: Pick<AsyncStorageStatic, 'setItem'>, preferences: ReadingPreferences): Promise<ReadingPreferences> {
  const saved = parseReadingPreferences(preferences);
  await storage.setItem(storageKey, JSON.stringify(saved));
  return saved;
}
// #endregion

// #region 의존성 가져오기
import { createContext, useContext, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Action, colors, s } from './ui';
// #endregion

// #region 연결 설정
/** 선택을 마치기 전에는 하위 화면을 마운트하지 않는 API 주소 컨텍스트입니다. */
const ApiUrlContext = createContext<string | null>(null);
/** 테스트 실행 명령 또는 테스트 번들에서 명시적으로 활성화하는 선택 화면입니다. */
const enableSelection = process.env.EXPO_PUBLIC_ENABLE_SERVER_SELECTION === 'true';
/** 일반 실행에서 바로 연결하며 테스트 실행에서 실제 개발 서버로 선택하는 주소입니다. */
const developmentUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
/** 간이 서버에 연결할 주소입니다. USB 개발은 adb reverse로 이 주소를 연결합니다. */
const mockUrl = process.env.EXPO_PUBLIC_MOCK_API_URL ?? 'http://127.0.0.1:8090';

/**
 * 연결 주소의 HTTP(S) 형식을 검사합니다.
 * @param value - 환경 변수로 설정한 API 기준 주소입니다.
 * @returns 사용자 정보·쿼리·해시가 없는 HTTP(S) 주소이면 참입니다.
 */
function isServerUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s\\]+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
// #endregion

// #region 서버 선택과 공급자
/**
 * 테스트 앱에서 서버를 선택하고 일반 앱에서는 설정된 서버를 바로 사용합니다.
 *
 * @remarks
 * 선택은 앱 세션의 메모리에만 보관합니다. 서버를 선택하기 전에는 홈 요청을 보내지 않습니다.
 * 일반 실행에는 선택 화면이 없으며 잘못된 주소를 간이 서버로 대체하지 않습니다.
 *
 * @param props - API 주소를 공유할 앱 화면입니다.
 * @returns 서버 선택·설정 안내 또는 API 주소가 제공된 앱 화면입니다.
 */
export function ServerConnectionProvider({ children }: {
  /** 서버 선택 이후 표시할 앱 화면입니다. */
  children: ReactNode;
}) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(enableSelection ? null : developmentUrl);
  if (selectedUrl !== null && isServerUrl(selectedUrl)) {
    return <ApiUrlContext.Provider value={selectedUrl.replace(/\/+$/, '')}>{children}</ApiUrlContext.Provider>;
  }
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={s.title}>{enableSelection ? '테스트 서버 선택' : '서버 주소 설정이 필요합니다.'}</Text>
      {enableSelection ? <>
        <Text style={s.muted}>이번 실행에서 사용할 서버를 선택합니다.</Text>
        <View style={styles.option}>
          <Text style={s.subtitle}>간이 서버</Text>
          <Text style={s.muted}>준비된 이미지와 SDUI 응답으로 화면을 확인합니다.</Text>
          <Text selectable style={styles.address}>{mockUrl}</Text>
          {!isServerUrl(mockUrl) && <Text style={s.error}>EXPO_PUBLIC_MOCK_API_URL을 확인해 주십시오.</Text>}
          <Action label="간이 서버 사용" disabled={!isServerUrl(mockUrl)} onPress={() => setSelectedUrl(mockUrl)} />
        </View>
        <View style={styles.option}>
          <Text style={s.subtitle}>실제 개발 서버</Text>
          <Text style={s.muted}>설정된 개발 API에서 홈 구성을 불러옵니다.</Text>
          <Text selectable style={styles.address}>{developmentUrl || '주소가 설정되지 않았습니다.'}</Text>
          {!isServerUrl(developmentUrl) && <Text style={s.error}>EXPO_PUBLIC_API_URL을 확인해 주십시오.</Text>}
          <Action label="실제 개발 서버 사용" tone="secondary" disabled={!isServerUrl(developmentUrl)} onPress={() => setSelectedUrl(developmentUrl)} />
        </View>
      </> : <Text style={s.muted}>앱 실행 설정의 EXPO_PUBLIC_API_URL을 확인해 주십시오.</Text>}
    </ScrollView>
  </SafeAreaView>;
}

/**
 * 이번 앱 실행에서 선택한 서버의 API 기준 주소를 읽습니다.
 * @returns 끝에 슬래시가 없는 HTTP(S) 주소입니다.
 * @throws Error - 서버 공급자 외부에서 호출하면 발생합니다.
 */
export function useApiUrl(): string {
  const value = useContext(ApiUrlContext);
  if (value === null) throw new Error('API 주소 공급자 내부에서 호출해야 합니다.');
  return value;
}
// #endregion

// #region 선택 화면 스타일
/** 테스트 선택 화면의 모바일 배치입니다. */
const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: '#fff' },
  content: { padding: 24, gap: 20 },
  option: { padding: 18, gap: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 18 },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
});
// #endregion

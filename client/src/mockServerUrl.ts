// #region 테스트용 간이 서버 주소
/**
 * 모바일 테스트에서 로컬 간이 서버의 호스트를 Expo 개발 PC 주소로 바꿉니다.
 *
 * @remarks
 * LAN 자동 변환을 명시적으로 켠 Android·iOS 테스트에만 적용합니다.
 * 기본 동작은 지정한 주소를 유지하므로 USB 역방향 연결에도 사용할 수 있습니다.
 * 자동 변환은 Expo의 LAN IP만 사용하며 포트와 경로는 유지합니다.
 *
 * @param configuredUrl - EXPO_PUBLIC_MOCK_API_URL에 지정한 간이 서버 주소입니다.
 * @param testMode - 테스트 서버 선택이 활성화되었는지 여부입니다.
 * @param platform - 앱을 실행하는 플랫폼입니다.
 * @param hostUri - Expo가 제공하는 개발 서버의 호스트와 포트입니다.
 * @param useExpoHost - Expo의 LAN IP로 로컬 주소를 바꿀지 여부입니다.
 * @returns 현재 플랫폼에서 사용할 간이 서버 주소입니다.
 * @throws Error - 자동 변환에 필요한 Expo LAN IP를 확인하지 못하면 발생합니다. 호출 화면에서 처리해야 합니다.
 */
export function resolveMockServerUrl(
  configuredUrl: string,
  testMode: boolean,
  platform: string,
  hostUri: string | undefined,
  useExpoHost = false,
): string {
  if (!useExpoHost || !testMode || (platform !== 'android' && platform !== 'ios')) return configuredUrl;
  const url = new URL(configuredUrl);
  if (!['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname)) return configuredUrl;
  if (!hostUri) throw new Error('Expo 개발 PC 주소를 확인하지 못했습니다. 테스트 서버 주소에 PC의 IP를 직접 지정하십시오.');
  const hostname = new URL(`http://${hostUri}`).hostname;
  const isIpAddress = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /^\[[\da-f:]+\]$/i.test(hostname);
  if (!isIpAddress || hostname.startsWith('127.') || hostname === '[::1]' || hostname === '0.0.0.0' || hostname === '[::]') {
    throw new Error('자동 주소 변환에는 Expo의 LAN IP가 필요합니다. 터널을 사용하는 경우 테스트 서버 주소를 직접 지정하십시오.');
  }
  url.hostname = hostname;
  return url.toString();
}
// #endregion

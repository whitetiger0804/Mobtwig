/**
 * 모북이 클라이언트의 Expo 실행 진입점입니다.
 *
 * @remarks
 * 모듈을 읽을 때 루트 앱 컴포넌트를 등록합니다.
 * 홈은 서버의 SDUI 표시 계약으로 구성하며 나머지 미연동 데이터 영역은 빈 요소를 표시합니다.
 * SDUI의 표시용 타입은 업무 데이터의 DB 저장 모델을 정의하지 않습니다.
 *
 * @packageDocumentation
 */
// #region 의존성 가져오기
import { registerRootComponent } from 'expo';

import App from './App';
// #endregion

// #region 앱 등록
registerRootComponent(App);
// #endregion

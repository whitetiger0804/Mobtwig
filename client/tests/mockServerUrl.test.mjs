import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { resolveMockServerUrl } from '../src/mockServerUrl.ts';

// #region 플랫폼별 간이 서버 연결
for (const platform of ['android', 'ios']) {
  test(`${platform} 테스트는 로컬 주소를 개발 PC로 바꾸고 포트와 경로를 유지합니다.`, () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.2.2']) {
      assert.equal(resolveMockServerUrl(`http://${host}:8090/api`, true, platform, '192.168.50.20:8081', true),
        'http://192.168.50.20:8090/api');
    }
  });

  test(`${platform} 일반 실행과 직접 지정한 mock 서버 주소는 바꾸지 않습니다.`, () => {
    assert.equal(resolveMockServerUrl('http://localhost:8090', false, platform, undefined, true), 'http://localhost:8090');
    for (const url of ['https://mock.example.test/api', 'http://192.168.50.10:9000']) {
      assert.equal(resolveMockServerUrl(url, true, platform, undefined, true), url);
    }
  });
}

test('웹은 테스트 여부와 관계없이 주소를 그대로 사용합니다.', () => {
  for (const testMode of [true, false]) {
    for (const url of ['http://localhost:8090', 'http://10.0.2.2:8090', 'https://mock.example.test']) {
      assert.equal(resolveMockServerUrl(url, testMode, 'web', undefined, true), url);
    }
  }
});

test('다른 mock 포트와 IPv6 개발 PC 주소도 유지합니다.', () => {
  assert.equal(resolveMockServerUrl('http://localhost:9000/api/', true, 'ios', '[fd00::12]:8081', true),
    'http://[fd00::12]:9000/api/');
});

test('자동 변환이 꺼져 있거나 미설정이면 USB용 루프백 주소를 유지합니다.', () => {
  for (const platform of ['android', 'ios']) {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.2.2']) {
      const url = `http://${host}:8080`;
      assert.equal(resolveMockServerUrl(url, true, platform, '192.168.50.20:8084'), url);
      assert.equal(resolveMockServerUrl(url, true, platform, undefined, false), url);
    }
  }
});

test('Expo 주소 누락과 터널·루프백·수신용 호스트는 LAN 변환 오류로 보고합니다.', () => {
  for (const hostUri of [undefined, 'project.exp.direct', 'project.ngrok-free.app', 'localhost:8084',
    '127.0.0.1:8084', '[::1]:8084', '0.0.0.0:8084', '[::]:8084']) {
    assert.throws(() => resolveMockServerUrl('http://localhost:8080', true, 'ios', hostUri, true), /Expo/);
  }
});
// #endregion

// #region 서버 선택 화면 회귀 검사
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/serverConnection.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

/**
 * 실제 TSX 모듈을 메모리에서 실행해 초기화·선택 상태를 검사합니다.
 * @remarks 네이티브 UI와 React 훅은 대체하며, 기기 레이아웃을 검증하는 테스트는 아닙니다.
 * @param options - 플랫폼·환경 변수·Expo 주소를 지정하는 검사 조건입니다.
 * @returns 화면을 다시 렌더링하고 선택 버튼을 조회하는 도구입니다.
 */
function createSelection({ platform = 'android', enabled = true, useExpoHost = true, hostUri,
  mockUrl = 'http://localhost:8080', apiUrl = 'https://development.example.test' } = {}) {
  const exports = {};
  let selected;
  let initialized = false;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react': {
      createContext: () => ({ Provider: 'Provider' }),
      useState: initial => {
        if (!initialized) { selected = initial; initialized = true; }
        return [selected, value => { selected = value; }];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: platform }, StyleSheet: { create: value => value },
      ScrollView: 'ScrollView', Text: 'Text', View: 'View' },
    'expo-constants': { expoConfig: { hostUri } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    './ui': { Action: 'Action', colors: { line: '#ddd', muted: '#777' }, s: {} },
    './mockServerUrl': { resolveMockServerUrl },
  };
  runInNewContext(compiled, {
    exports, URL, Error,
    require: name => { assert.ok(name in modules, name); return modules[name]; },
    process: { env: {
      EXPO_PUBLIC_ENABLE_SERVER_SELECTION: String(enabled), EXPO_PUBLIC_MOCK_USE_EXPO_HOST: String(useExpoHost),
      EXPO_PUBLIC_MOCK_API_URL: mockUrl, EXPO_PUBLIC_API_URL: apiUrl,
    } },
  });
  const render = () => exports.ServerConnectionProvider({ children: 'app' });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const button = label => nodes(render()).find(node => node.type === 'Action' && node.props.label === label).props;
  return { render, button };
}

for (const platform of ['android', 'ios']) {
  test(`${platform}의 Expo 주소가 없어도 실제 개발 서버를 선택할 수 있습니다.`, () => {
    const screen = createSelection({ platform });
    assert.equal(screen.render().type, 'SafeAreaView');
    assert.match(JSON.stringify(screen.render()), /Expo 개발 PC 주소를 확인하지 못했습니다/);
    assert.equal(screen.button('간이 서버 사용').disabled, true);
    const actual = screen.button('실제 개발 서버 사용');
    assert.equal(actual.disabled, false);
    actual.onPress();
    assert.equal(screen.render().type, 'Provider');
    assert.equal(screen.render().props.value, 'https://development.example.test');
  });
}

test('터널과 잘못된 mock 주소는 해당 선택지만 막고 실제 서버 선택은 유지합니다.', () => {
  for (const options of [{ hostUri: 'project.exp.direct' }, { hostUri: '잘못된 주소' }, { mockUrl: '잘못된 주소' }]) {
    const screen = createSelection(options);
    assert.equal(screen.button('간이 서버 사용').disabled, true);
    assert.equal(screen.button('실제 개발 서버 사용').disabled, false);
    screen.button('실제 개발 서버 사용').onPress();
    assert.equal(screen.render().props.value, 'https://development.example.test');
  }
});

test('LAN 자동 변환은 mock 선택에만 적용하고 실제 API 주소는 유지합니다.', () => {
  const options = { hostUri: '192.168.50.20:8084', apiUrl: 'http://localhost:9000' };
  const mock = createSelection(options);
  mock.button('간이 서버 사용').onPress();
  assert.equal(mock.render().props.value, 'http://192.168.50.20:8080');
  const actual = createSelection(options);
  actual.button('실제 개발 서버 사용').onPress();
  assert.equal(actual.render().props.value, 'http://localhost:9000');
});

test('직접 연결과 웹은 Expo 정보 없이 지정한 주소를 선택합니다.', () => {
  for (const options of [{ useExpoHost: false }, { platform: 'web' }]) {
    const screen = createSelection(options);
    assert.equal(screen.button('간이 서버 사용').disabled, false);
    screen.button('간이 서버 사용').onPress();
    assert.equal(screen.render().props.value, 'http://localhost:8080');
  }
});

test('일반 실행은 mock 설정 오류와 관계없이 실제 API로 시작합니다.', () => {
  const screen = createSelection({ enabled: false, mockUrl: '잘못된 주소' });
  assert.equal(screen.render().type, 'Provider');
  assert.equal(screen.render().props.value, 'https://development.example.test');
});
// #endregion

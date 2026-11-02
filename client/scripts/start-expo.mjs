// #region Expo 개발 서버 실행
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const env = { ...process.env, EXPO_NO_REDIRECT_PAGE: 'true' };

// 일반 실행에는 영향을 주지 않고 테스트 실행에서만 서버 선택을 활성화합니다.
if (args.includes('--server-selection')) {
  env.EXPO_PUBLIC_ENABLE_SERVER_SELECTION = 'true';
}

const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), 'start', ...args.filter(arg => arg !== '--server-selection')], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
  env,
});
child.on('error', error => {
  console.error(`Expo 개발 서버를 실행하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
// #endregion

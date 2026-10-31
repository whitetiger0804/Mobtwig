// #region 테스트 실행
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), 'start', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_ENABLE_SERVER_SELECTION: 'true' },
});
child.on('error', error => {
  console.error(`테스트 앱을 실행하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
// #endregion

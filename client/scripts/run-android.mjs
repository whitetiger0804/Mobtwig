// #region Android 개발 앱 실행
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
let projectRoot = sourceRoot;
const env = { ...process.env };

// Expo와 같은 환경 파일 우선순위로 API 주소를 읽습니다.
// 도움말에서는 기기를 선택하거나 연결을 변경하지 않습니다.
if (!args.includes('--help') && !args.includes('-h')) {
  const expoRequire = createRequire(join(sourceRoot, 'node_modules/expo/package.json'));
  const { parseProjectEnv } = expoRequire('@expo/env');
  const variantIndex = args.findIndex(arg => arg === '--variant' || arg.startsWith('--variant='));
  const variant = variantIndex < 0 ? 'debug' : args[variantIndex].split('=')[1] ?? args[variantIndex + 1];
  const mode = ['debug', 'debugoptimized'].includes(variant?.toLowerCase()) ? 'development' : 'production';
  const { env: fileEnv } = parseProjectEnv(sourceRoot, { mode, systemEnv: env });
  const apiUrl = env.EXPO_PUBLIC_API_URL ?? fileEnv.EXPO_PUBLIC_API_URL;
  const url = apiUrl ? new URL(apiUrl) : undefined;

  // 실제 서버와 LAN 주소는 직접 접속하므로 휴대폰의 루프백 주소만 연결합니다.
  if (url && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    // 설치된 Expo CLI의 기기 선택과 SDK 탐색을 재사용합니다.
    const { resolveDeviceAsync } = expoRequire('@expo/cli/build/src/run/android/resolveDevice');
    const { getServer } = expoRequire('@expo/cli/build/src/start/platforms/android/adb');
    const deviceIndex = args.findIndex(arg => /^(--device|-d)(=|$)/.test(arg));
    let deviceOption;
    if (deviceIndex >= 0) {
      const hasInlineValue = args[deviceIndex].includes('=');
      const hasNextValue = !hasInlineValue && args[deviceIndex + 1] !== undefined && !args[deviceIndex + 1].startsWith('-');
      deviceOption = hasInlineValue ? args[deviceIndex].slice(args[deviceIndex].indexOf('=') + 1)
        : hasNextValue ? args[deviceIndex + 1] : true;
      args.splice(deviceIndex, hasNextValue ? 2 : 1);
    }
    const manager = await resolveDeviceAsync(deviceOption);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    await getServer().runDeviceMutationAsync(
      ['-s', manager.device.pid, 'reverse', `tcp:${port}`, `tcp:${port}`],
      '로컬 API 포트 연결', undefined, 5_000,
    );
    console.log(`[Android] ${manager.device.name}: 로컬 API의 ${port}번 포트를 연결했습니다.`);
    // 연결한 기기에 설치하도록 고정해 다른 기기가 선택되는 것을 막습니다.
    args.push('--device', manager.device.pid);
  }
}

// Windows의 한글 경로 검사와 C++ 오브젝트 경로 길이 제한을 피합니다.
// 정션은 같은 소스를 가리키므로 복사본 없이 수정 사항이 즉시 반영됩니다.
// 네이티브 모듈의 상대 경로 계산을 위해 원본과 같은 드라이브에 생성합니다.
if (process.platform === 'win32') {
  const projectId = createHash('sha256').update(sourceRoot).digest('hex').slice(0, 10);
  projectRoot = join(parse(sourceRoot).root, 'MobtwigDev', projectId);
  mkdirSync(dirname(projectRoot), { recursive: true });
  if (!existsSync(projectRoot)) {
    symlinkSync(sourceRoot, projectRoot, 'junction');
  }
  if (realpathSync(projectRoot) !== sourceRoot) {
    throw new Error(`Android 실행 경로가 다른 폴더를 가리킵니다: ${projectRoot}`);
  }
  env.NODE_OPTIONS = [env.NODE_OPTIONS, '--preserve-symlinks', '--preserve-symlinks-main'].filter(Boolean).join(' ');
}

const child = spawn(process.execPath, [join(projectRoot, 'node_modules/expo/bin/cli'), 'run:android', ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
});
child.on('error', error => {
  console.error(`Android 개발 앱을 실행하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
// #endregion

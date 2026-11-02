// #region Android 개발 앱 실행
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
let projectRoot = sourceRoot;
const env = { ...process.env };

// Windows의 한글 경로 검사와 C++ 오브젝트 경로 길이 제한을 피합니다.
// 정션은 같은 소스를 가리키므로 복사본 없이 수정 사항이 즉시 반영됩니다.
if (process.platform === 'win32') {
  const projectId = createHash('sha256').update(sourceRoot).digest('hex').slice(0, 10);
  projectRoot = join(parse(homedir()).root, 'MobtwigDev', projectId);
  mkdirSync(dirname(projectRoot), { recursive: true });
  if (!existsSync(projectRoot)) {
    symlinkSync(sourceRoot, projectRoot, 'junction');
  }
  if (realpathSync(projectRoot) !== sourceRoot) {
    throw new Error(`Android 실행 경로가 다른 폴더를 가리킵니다: ${projectRoot}`);
  }
  env.NODE_OPTIONS = [env.NODE_OPTIONS, '--preserve-symlinks', '--preserve-symlinks-main'].filter(Boolean).join(' ');
}

const child = spawn(process.execPath, [join(projectRoot, 'node_modules/expo/bin/cli'), 'run:android', ...process.argv.slice(2)], {
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

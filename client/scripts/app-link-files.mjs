import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import base from '../app.json' with { type: 'json' };
import configure from '../app.config.js';
import { shareOrigin } from '../src/workSharing.ts';

/** 확정된 공개 인증서 지문과 Apple 앱 식별자로 도메인 검증 파일을 구성합니다. */
export function createAssociationFiles(config, fingerprints, appleAppId) {
  const files = {};
  if (fingerprints.length) {
    const hashes = [...new Set(fingerprints.map(hash => {
      if (!/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(hash)) {
        throw new Error('Android 인증서 SHA-256은 콜론으로 구분한 32바이트 지문이어야 합니다.');
      }
      return hash.toUpperCase();
    }))];
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(config.android?.package ?? '')) {
      throw new Error('Android 패키지명을 확인해 주세요.');
    }
    files['assetlinks.json'] = [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: config.android.package,
        sha256_cert_fingerprints: hashes,
      },
    }];
  }
  if (appleAppId !== undefined) {
    if (!config.ios?.bundleIdentifier || !/^[A-Z0-9]{10}\./.test(appleAppId)
        || appleAppId.slice(11) !== config.ios.bundleIdentifier) {
      throw new Error('Apple application-identifier의 prefix와 설정된 iOS Bundle ID를 확인해 주세요.');
    }
    files['apple-app-site-association'] = {
      applinks: { apps: [], details: [{ appID: appleAppId, paths: ['/s/works/*'] }] },
    };
  }
  if (Object.keys(files).length === 0) {
    throw new Error('Android 배포 인증서 SHA-256 또는 Apple 앱 식별자를 지정해 주세요.');
  }
  return files;
}

async function main() {
  const { values } = parseArgs({
    options: {
      'output-dir': { type: 'string' },
      'android-sha256': { type: 'string', multiple: true },
      'ios-app-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('node scripts/app-link-files.mjs --output-dir <.well-known 폴더> [--android-sha256 <지문>] [--ios-app-id <prefix.BundleID>]');
    return;
  }
  if (!values['output-dir']) throw new Error('--output-dir에 생성할 .well-known 폴더를 지정해 주세요.');
  const origin = new URL(shareOrigin(process.env.EXPO_PUBLIC_SHARE_BASE_URL));
  if (origin.protocol !== 'https:' || origin.port) {
    throw new Error('도메인 검증 파일에는 포트가 없는 HTTPS 공유 origin이 필요합니다.');
  }
  const config = configure({ config: base.expo });
  const files = createAssociationFiles(config, values['android-sha256'] ?? [], values['ios-app-id']);
  const output = resolve(values['output-dir']);
  await mkdir(output, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    await writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
    console.log(join(output, name));
  }
  console.log('검증 대상 origin: ' + origin.origin);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(failure => { console.error(failure.message); process.exitCode = 1; });
}

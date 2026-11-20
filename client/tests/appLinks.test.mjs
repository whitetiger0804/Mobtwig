import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import base from '../app.json' with { type: 'json' };
import configure from '../app.config.js';
import { createAssociationFiles } from '../scripts/app-link-files.mjs';

function configured(values = {}) {
  const names = ['EXPO_PUBLIC_SHARE_BASE_URL', 'IOS_BUNDLE_IDENTIFIER', 'APPLE_TEAM_ID'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) {
      if (values[name] === undefined) delete process.env[name];
      else process.env[name] = values[name];
    }
    return configure({ config: base.expo });
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

const hash = Array(32).fill('AB').join(':');

test('공유 origin의 작품 경로만 Android 자동 검증 대상으로 설정합니다.', () => {
  const normal = configured();
  assert.equal(normal.scheme, 'mobtwig');
  assert.equal(normal.android.package, base.expo.android.package);
  assert.deepEqual(normal.android.intentFilters, [{
    action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'],
    data: [{ scheme: 'https', host: 'mobtwig.xn--3h3b098b.kro.kr', pathPrefix: '/s/works/' }],
  }]);
  assert.equal(normal.ios, undefined);
  const custom = configured({ EXPO_PUBLIC_SHARE_BASE_URL: 'https://preview.example.test' });
  assert.equal(custom.android.intentFilters[0].data[0].host, 'preview.example.test');
  assert.deepEqual(configured({ EXPO_PUBLIC_SHARE_BASE_URL: 'http://127.0.0.1:8090' }).android.intentFilters, []);
  assert.throws(() => configured({ EXPO_PUBLIC_SHARE_BASE_URL: 'https://preview.example.test:8443' }));
  assert.throws(() => configured({ EXPO_PUBLIC_SHARE_BASE_URL: 'https://preview.example.test/another' }));
});

test('확정한 iOS 식별자에만 공유 도메인을 연결하고 잘못된 서명 설정을 거절합니다.', () => {
  const ios = configured({ IOS_BUNDLE_IDENTIFIER: 'com.example.reader', APPLE_TEAM_ID: 'ABCDE12345' }).ios;
  assert.equal(ios.bundleIdentifier, 'com.example.reader');
  assert.equal(ios.appleTeamId, 'ABCDE12345');
  assert.deepEqual(ios.associatedDomains, ['applinks:mobtwig.xn--3h3b098b.kro.kr']);
  for (const values of [{ APPLE_TEAM_ID: 'ABCDE12345' }, { IOS_BUNDLE_IDENTIFIER: '../reader' },
    { IOS_BUNDLE_IDENTIFIER: 'com.example.reader', APPLE_TEAM_ID: 'bad' }]) {
    assert.throws(() => configured(values));
  }
});

test('Android 검증 파일은 실제 입력 지문만 포함하고 중복·대소문자를 정리합니다.', () => {
  const files = createAssociationFiles(configured(), [hash, hash.toLowerCase()], undefined);
  assert.deepEqual(Object.keys(files), ['assetlinks.json']);
  assert.deepEqual(files['assetlinks.json'], [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: base.expo.android.package, sha256_cert_fingerprints: [hash] },
  }]);
  for (const invalid of ['', hash.slice(0, -3), 'not-a-certificate', hash.replaceAll(':', '')]) {
    assert.throws(() => createAssociationFiles(configured(), [invalid], undefined));
  }
  assert.throws(() => createAssociationFiles(configured(), [], undefined));
});

test('AASA 파일의 앱 ID와 Bundle ID가 일치하며 작품 경로만 연결합니다.', () => {
  const config = configured({ IOS_BUNDLE_IDENTIFIER: 'com.example.reader' });
  const files = createAssociationFiles(config, [], 'ABCDE12345.com.example.reader');
  assert.deepEqual(files, {
    'apple-app-site-association': { applinks: { apps: [], details: [{
      appID: 'ABCDE12345.com.example.reader', paths: ['/s/works/*'],
    }] } },
  });
  assert.throws(() => createAssociationFiles(config, [hash], 'ABCDE12345.com.other.reader'));
});

test('생성 명령은 모든 입력을 검증한 후 JSON 파일을 쓰며 오류 시 출력 폴더를 만들지 않습니다.', async context => {
  const temp = await mkdtemp(join(tmpdir(), 'mobtwig-links-'));
  context.after(() => rm(temp, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/app-link-files.mjs', import.meta.url));
  const env = { ...process.env, EXPO_PUBLIC_SHARE_BASE_URL: 'https://preview.example.test', IOS_BUNDLE_IDENTIFIER: 'com.example.reader' };
  delete env.APPLE_TEAM_ID;
  const invalidOutput = join(temp, 'invalid');
  const invalid = spawnSync(process.execPath, [script, '--output-dir', invalidOutput,
    '--android-sha256', hash, '--ios-app-id', 'ABCDE12345.com.other.reader'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(existsSync(invalidOutput), false);
  const output = join(temp, '.well-known');
  const valid = spawnSync(process.execPath, [script, '--output-dir', output,
    '--android-sha256', hash, '--ios-app-id', 'ABCDE12345.com.example.reader'], { env, encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(await readFile(join(output, 'assetlinks.json'), 'utf8'))[0].target.sha256_cert_fingerprints[0], hash);
  assert.equal(JSON.parse(await readFile(join(output, 'apple-app-site-association'), 'utf8')).applinks.details[0].appID,
    'ABCDE12345.com.example.reader');
});

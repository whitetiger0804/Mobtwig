import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadReadingPreferences, parseReadingPreferences, saveReadingPreferences } from '../src/readingPreferences.ts';

test('처음 실행한 기기에는 기존 기본값을 적용합니다.', async () => {
  const preferences = await loadReadingPreferences({ getItem: async () => null });
  assert.deepEqual(preferences, { theme: '크림', font: '기본 명조', size: 2 });
});

test('기기에 저장한 설정은 새 실행에서 복원되며 원본 객체 변경의 영향을 받지 않습니다.', async () => {
  const values = new Map();
  const preferences = { theme: '다크', font: '고운바탕', size: 4 };
  const saved = await saveReadingPreferences({ setItem: async (key, value) => { values.set(key, value); } }, preferences);
  preferences.theme = '크림';
  const restored = await loadReadingPreferences({ getItem: async key => values.get(key) ?? null });
  assert.deepEqual(restored, { theme: '다크', font: '고운바탕', size: 4 });
  assert.deepEqual(saved, restored);
});

test('지원하지 않는 설정과 손상된 JSON을 정상 설정으로 처리하지 않습니다.', async () => {
  const valid = { theme: '크림', font: '기본 명조', size: 2 };
  for (const value of [null, [], {}, { ...valid, theme: '없는 테마' }, { ...valid, font: '없는 글꼴' },
    { ...valid, size: -1 }, { ...valid, size: 5 }, { ...valid, size: 2.5 }, { ...valid, size: '2' }]) {
    assert.throws(() => parseReadingPreferences(value));
  }
  await assert.rejects(loadReadingPreferences({ getItem: async () => '{' }));
});

test('읽기·쓰기 실패를 호출자에게 전달하며 쓰기 완료 전에 성공하지 않습니다.', async () => {
  const failure = new Error('기기 저장소 오류');
  await assert.rejects(loadReadingPreferences({ getItem: async () => { throw failure; } }), failure);
  await assert.rejects(saveReadingPreferences({ setItem: async () => { throw failure; } },
    { theme: '크림', font: '기본 명조', size: 2 }), failure);
  let finish;
  let completed = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const save = saveReadingPreferences({ setItem: () => pending }, { theme: '연회색', font: '기본 고딕', size: 0 })
    .then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  await save;
  assert.equal(completed, true);
});

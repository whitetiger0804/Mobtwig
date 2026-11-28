import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as drafts from '../src/communityDrafts.ts';
import { editor, device, scope, input, gate } from './helpers/communityEditor.mjs';
test('초안 읽기가 대기·실패해도 편집과 등록은 열려 있고 재시도는 현재 입력을 보존합니다.', async t => {
  const storage = device(), read = gate(); let fail = true;
  const ui = editor({ ...storage, getItem: () => fail ? read.promise : Promise.resolve(null) });
  t.after(ui.unmount); await ui.flush();
  assert.ok(ui.find('게시글 제목')); await ui.fill();
  assert.equal(ui.find('임시저장').props.disabled, true);
  read.reject(new Error('기기 읽기 실패')); await ui.flush();
  assert.ok(ui.text().includes('작성·등록은 가능')); assert.equal(ui.find('등록하기').props.disabled, false);
  fail = false; await ui.press('임시저장 다시 확인');
  assert.equal(ui.find('게시글 제목').props.value, input.title);
});

test('저장 완료 전에는 저장 중을 표시하고 실패하면 입력과 이전 초안을 유지하며 재시도합니다.', async t => {
  const storage = device(); await drafts.saveLocalCommunityDraft(storage, scope, { ...input, title: '이전 제목' });
  const saving = gate(); let delayed = true, writes = 0;
  const ui = editor({ ...storage, setItem: async (key, value) => { writes++; if (delayed) await saving.promise; await storage.setItem(key, value); } });
  t.after(ui.unmount); await ui.flush(); await ui.press('새 글 쓰기'); await ui.fill();
  const press = ui.find('임시저장').props.onPress; press(); press(); await ui.flush();
  assert.equal(writes, 1); assert.ok(ui.find('임시저장 중')); assert.equal(ui.find('등록하기').props.disabled, true);
  saving.reject(new Error('용량 부족')); await ui.flush();
  assert.equal(ui.find('게시글 제목').props.value, input.title); assert.ok(ui.text().includes('임시저장하지 못했습니다'));
  assert.equal((await drafts.loadLocalCommunityDraft(storage, scope)).title, '이전 제목');
  delayed = false; await ui.press('임시저장');
  assert.ok(ui.find('임시저장됨')); assert.ok(ui.text().includes('이 기기에 임시저장했습니다'));
  assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), input);
});

test('게시 후 정리 실패는 게시 완료로 표시하며 새 초안을 보존하고 재등록 없이 정리 재시도합니다.', async t => {
  const storage = device(); await drafts.saveLocalCommunityDraft(storage, scope, input);
  let fail = true;
  const ui = editor({ ...storage, removeItem: async key => { if (fail) throw new Error('삭제 실패'); await storage.removeItem(key); } });
  t.after(ui.unmount); await ui.flush(); await ui.press('불러오기'); await ui.press('등록하기');
  assert.equal(ui.posts, 1); assert.equal(ui.navigation.length, 0); assert.ok(ui.text().includes('게시글을 등록했습니다'));
  assert.equal(ui.find('등록하기'), undefined); assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), input);
  const newInput = { ...input, title: '이후에 저장한 새 초안' }; await drafts.saveLocalCommunityDraft(storage, scope, newInput);
  fail = false; await ui.press('임시저장 정리 다시 시도');
  assert.equal(ui.posts, 1); assert.equal(ui.navigation[0].postId, '99');
  assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), newInput); assert.equal(ui.ignored, 0);
});

test('새 글 쓰기로 남겨 둔 초안과 게시 실패한 초안은 삭제하지 않습니다.', async t => {
  for (const restore of [false, true]) {
    const storage = device(); await drafts.saveLocalCommunityDraft(storage, scope, input);
    const ui = editor(storage, restore ? { publish: async () => { throw new Error('게시 실패'); } } : {});
    t.after(ui.unmount); await ui.flush(); await ui.press(restore ? '불러오기' : '새 글 쓰기'); await ui.fill(); await ui.press('등록하기');
    assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), input);
    assert.equal(ui.posts, 1); assert.equal(ui.navigation.length, restore ? 0 : 1);
  }
});

test('삭제 실패는 확인창에서 재시도하고 성공해도 현재 작성 입력은 지우지 않습니다.', async t => {
  const storage = device(); await drafts.saveLocalCommunityDraft(storage, scope, input); let fail = true;
  const ui = editor({ ...storage, removeItem: async key => { if (fail) throw new Error('기기 삭제 실패'); await storage.removeItem(key); } });
  t.after(ui.unmount); await ui.flush(); await ui.press('불러오기'); await ui.fill('현재 입력');
  await ui.press('임시저장 삭제'); await ui.confirm();
  const dialog = ui.nodes().find(node => node.type === 'Confirm'); assert.ok(dialog.props.error.includes('삭제를 확인하지 못했습니다'));
  fail = false; await ui.confirm(); assert.equal(await drafts.loadLocalCommunityDraft(storage, scope), null);
  assert.equal(ui.find('게시글 제목').props.value, '현재 입력');
});

test('현재 규칙에 맞지 않는 초안은 복원하지 않으며 손상된 초안은 명시적 삭제 후 저장할 수 있습니다.', async t => {
  const storage = device(); await drafts.saveLocalCommunityDraft(storage, scope, { ...input, stickerIds: ['99'] });
  const ui = editor(storage); t.after(ui.unmount); await ui.flush(); await ui.press('불러오기');
  assert.ok(ui.text().includes('현재 사용할 수 없는 이모티콘')); assert.equal(ui.find('게시글 제목').props.value, '');
  ui.unmount(); const [key] = storage.values.keys(); storage.values.set(key, '{broken');
  const next = editor(storage); t.after(next.unmount); await next.flush(); await next.fill();
  assert.equal(next.find('임시저장').props.disabled, true); await next.press('손상된 임시저장 삭제'); await next.confirm();
  assert.equal(next.find('임시저장').props.disabled, false); await next.press('임시저장');
  assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), input);
});

test('이전 회원의 늦은 저장 완료가 새 회원 화면의 저장 상태를 덮지 않습니다.', async t => {
  const storage = device(), saving = gate();
  const ui = editor({ ...storage, setItem: async (key, value) => { await saving.promise; await storage.setItem(key, value); } });
  t.after(ui.unmount); await ui.flush(); await ui.fill(); await ui.press('임시저장'); await ui.changeMember('14');
  assert.equal(ui.find('게시글 제목').props.value, '');
  saving.resolve(); await ui.flush();
  assert.ok(ui.find('임시저장')); assert.equal(ui.find('임시저장').props.disabled, false); assert.equal(ui.ignored, 0);
  assert.deepEqual(await drafts.loadLocalCommunityDraft(storage, scope), input);
  assert.equal(await drafts.loadLocalCommunityDraft(storage, { ...scope, memberId: '14' }), null);
});

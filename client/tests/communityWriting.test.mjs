import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCommunityPostForBoard } from '../src/community.ts';
import { saveLocalCommunityDraft } from '../src/communityDrafts.ts';
import { normalizeCommunityBody } from '../src/communityBody.ts';
import { editor, device, scope, input, gate } from './helpers/communityEditor.mjs';

const work = { id: 'star-record', kind: 'novel', title: '별의 기록', author: '기록가', imageUrl: null };
const topic = { id: '21', name: '독서 이야기', type: 'topic', work: null, heads: ['STORY', 'QUESTION'] };

test('게시 입력은 현재 게시판·말머리·작품·이모티콘을 확인하고 기존 API가 허용한 연결은 유지합니다.', () => {
  const workBoard = { ...topic, type: 'work', work, heads: ['IMPRESSION', 'QUESTION'] };
  const workInput = { ...input, head: 'IMPRESSION', workId: work.id };
  assert.deepEqual(validateCommunityPostForBoard(workInput, workBoard, []), workInput);
  assert.equal(validateCommunityPostForBoard({ ...workInput, workId: null }, workBoard, []).workId, null);
  assert.equal(validateCommunityPostForBoard({ ...input, workId: work.id }, topic, []).workId, work.id);
  const promotion = { ...topic, type: 'promotion', heads: ['PROMOTION'] };
  assert.equal(validateCommunityPostForBoard({ ...input, head: 'PROMOTION', workId: work.id }, promotion, []).head, 'PROMOTION');
  for (const [value, board] of [[{ ...input, boardId: '22' }, topic], [{ ...input, head: 'PROMOTION' }, topic],
    [{ ...workInput, workId: 'other-work' }, workBoard], [{ ...input, head: 'PROMOTION' }, promotion],
    [{ ...input, stickerIds: ['99'] }, topic]]) {
    assert.throws(() => validateCommunityPostForBoard(value, board, []));
  }
});

test('이모지 최대 길이를 조기 제한하지 않고 초과 붙여넣기는 원문을 보존하며 요청하지 않습니다.', async t => {
  const ui = editor(device()); t.after(ui.unmount); await ui.flush();
  assert.equal(ui.find('게시글 제목').props.maxLength, undefined); assert.equal(ui.find('게시글 본문').props.maxLength, undefined);
  await ui.fill('😀'.repeat(100), '🙂'.repeat(10000));
  assert.ok(ui.text().includes('제목 100 / 100')); assert.ok(ui.text().includes('본문 10,000 / 10,000'));
  assert.equal(ui.find('등록하기').props.disabled, false);
  for (const [title, body, message] of [['😀'.repeat(101), '본문', '제목은 100자'], ['제목', '🙂'.repeat(10001), '본문은 10,000자'], ['\u0085 \n', '본문', '']]) {
    await ui.fill(title, body); assert.equal(ui.find('등록하기').props.disabled, true);
    if (message) assert.ok(ui.text().includes(message));
    // 비활성화 이전에 잡힌 이벤트가 실행돼도 게시 검증을 통과하지 못합니다.
    ui.find('등록하기').props.onPress(); await ui.flush(); assert.equal(ui.posts, 0);
    assert.equal(ui.find('게시글 제목').props.value, title); assert.equal(ui.find('게시글 본문').props.value, body);
  }
  await ui.fill('😀'.repeat(100), '🙂'.repeat(10000)); await ui.press('등록하기');
  assert.equal(ui.posts, 1); assert.equal(ui.navigation[0].postId, '99');
});

test('글자 수와 게시 입력은 양끝 공백과 첨부 표식을 제외하고 내부 줄바꿈을 유지합니다.', async t => {
  const storage = device();
  const image = { url: '/community/images/13/01234567-89ab-cdef-0123-456789abcdef.png', width: 32, height: 32 };
  const body = '\u0085 \n' + normalizeCommunityBody('🙂'.repeat(9998) + '\n가', [image]) + '\n\uFEFF';
  await saveLocalCommunityDraft(storage, scope, { ...input, title: ' \u0085제목\uFEFF ', body, images: [image] });
  const ui = editor(storage); t.after(ui.unmount); await ui.flush(); await ui.press('불러오기');
  assert.ok(ui.text().includes('제목 2 / 100')); assert.ok(ui.text().includes('본문 10,000 / 10,000'));
  assert.ok(ui.text().includes('커뮤니티에 공개')); assert.ok(ui.text().includes('확인 후 누구나 내용을 볼 수 있습니다'));
  await ui.press('등록하기');
  assert.equal(ui.submissions[0].title, '제목');
  assert.equal(ui.submissions[0].body, normalizeCommunityBody('🙂'.repeat(9998) + '\n가', [image]));
});

test('작품·주제·홍보 글은 현재 대상과 말머리·스포일러 선택을 게시하고 상세로 이동합니다.', async t => {
  for (const board of [topic, { ...topic, type: 'work', work, heads: ['IMPRESSION', 'QUESTION'] },
    { ...topic, type: 'promotion', heads: ['PROMOTION'] }]) {
    const ui = editor(device(), { board, works: [work] }); t.after(ui.unmount); await ui.flush();
    if (board.type === 'promotion') {
      assert.equal(ui.find('등록하기').props.disabled, true);
      ui.nodes().find(node => node.type === 'CommunitySearch').props.onChange('별'); await ui.flush();
      ui.nodes().find(node => node.type === 'WorkSummary').props.onPress(); await ui.flush();
    } else {
      const radio = ui.nodes().find(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio'
        && node.props.children?.props?.children === '질문');
      radio.props.onPress(); await ui.flush();
    }
    ui.nodes().find(node => node.type === 'SpoilerButton').props.onChange(true); await ui.flush();
    await ui.fill(); await ui.press('등록하기');
    assert.equal(ui.submissions[0].head, board.type === 'promotion' ? 'PROMOTION' : 'QUESTION');
    assert.equal(ui.submissions[0].workId, board.type === 'topic' ? null : work.id);
    assert.equal(ui.submissions[0].hasSpoiler, true); assert.equal(ui.submissions[0].spoilerChapterId, null);
    assert.equal(ui.navigation[0].mode, board.type); assert.equal(ui.navigation[0].postId, '99');
  }
});

test('게시 실패는 입력을 보존하며 중복 제출과 계정 전환 뒤 늦은 성공 이동을 막습니다.', async t => {
  const response = gate(); const ui = editor(device(), { publish: () => response.promise }); t.after(ui.unmount);
  await ui.flush(); await ui.fill();
  const press = ui.find('등록하기').props.onPress; press(); press(); await ui.flush();
  assert.equal(ui.posts, 1); assert.equal(ui.find('게시글 제목').props.editable, false);
  response.reject(new TypeError('연결 실패')); await ui.flush();
  assert.equal(ui.find('게시글 제목').props.value, input.title); assert.equal(ui.find('게시글 본문').props.value, input.body);
  assert.equal(ui.find('등록하기').props.disabled, false); assert.equal(ui.navigation.length, 0);
  const delayed = gate(); const switched = editor(device(), { publish: () => delayed.promise }); t.after(switched.unmount);
  await switched.flush(); await switched.fill(); await switched.press('등록하기'); await switched.changeMember('14');
  delayed.resolve({ id: '99', boardId: '21', boardType: 'topic' }); await switched.flush();
  assert.equal(switched.find('게시글 제목').props.value, ''); assert.equal(switched.navigation.length, 0); assert.equal(switched.ignored, 0);
});

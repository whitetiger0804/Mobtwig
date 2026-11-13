import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildSignupInput, parseSignupDocuments, parseSignupProblem, SignupProblem } from '../src/memberSignup.ts';
import { createMemberSessionClient } from '../src/memberSession.ts';

const version = 'demo-2026-11-07-v1';
const policies = await Promise.all([
  ['TERMS', '이용약관 · 임시 시연용', 'terms.txt'],
  ['PRIVACY', '개인정보 수집·이용 동의 · 임시 시연용', 'privacy.txt'],
].map(async ([kind, title, file]) => {
  const body = (await readFile(new URL(`../../server/src/main/resources/policies/${version}/${file}`, import.meta.url), 'utf8'))
    .replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return { kind, version, title, body, contentHash: createHash('sha256').update(body).digest('hex'), temporary: true };
}));
const documents = parseSignupDocuments({ documents: policies });
const accepted = Object.fromEntries(documents.map(doc => [doc.kind, doc]));
const form = { email: ' Reader@Example.Test ', nickname: ' 시연 회원 ', password: 'Abcdef12', passwordConfirmation: 'Abcdef12' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('원문과 동의한 문서 식별값을 그대로 사용합니다.', () => {
  assert.deepEqual(documents, policies);
  const request = buildSignupInput(form, documents, accepted);
  assert.equal(request.email, 'reader@example.test');
  assert.equal(request.nickname, '시연 회원');
  assert.deepEqual(request.consents, policies.map(({ kind, version, contentHash }) => ({ kind, version, contentHash, agreed: true })));
  assert.throws(() => parseSignupDocuments({ documents: [policies[0], policies[0]] }), /문서 응답/);
});

test('문서가 갱신되거나 미동의이면 해당 항목을 표시합니다.', () => {
  const latest = [{ ...documents[0], version: 'new-version' }, documents[1]];
  assert.throws(() => buildSignupInput(form, latest, { TERMS: accepted.TERMS }), error => {
    assert.ok(error instanceof SignupProblem);
    assert.deepEqual(Object.keys(error.fields).sort(), ['privacy', 'terms']);
    return true;
  });
});

test('입력별 오류와 비밀번호의 UTF-8 한도를 확인합니다.', () => {
  assert.throws(() => buildSignupInput({ email: 'broken', nickname: ' ', password: 'abcdefghi', passwordConfirmation: 'bad' }, documents, accepted),
    error => {
      assert.deepEqual(Object.keys(error.fields).sort(), ['email', 'nickname', 'password', 'passwordConfirmation']);
      return true;
    });
  const password = 'Ab12' + '한'.repeat(22) + 'cd';
  assert.equal(buildSignupInput({ ...form, password, passwordConfirmation: password }, documents, accepted).password, password);
  assert.throws(() => buildSignupInput({ ...form, password: password + 'x', passwordConfirmation: password + 'x' }, documents, accepted),
    error => /72바이트/.test(error.fields.password));
});

test('가입 요청은 CSRF와 명시적 동의를 전송하고 로그인 상태는 익명으로 유지합니다.', async () => {
  const calls = [];
  const client = createMemberSessionClient('https://test.example', async (input, init) => {
    const path = new URL(input).pathname;
    calls.push(path);
    assert.equal(init.credentials, 'include');
    if (path === '/api/auth/session') return json({}, 401);
    if (path === '/api/auth/terms') return json({ documents: policies });
    if (path === '/api/auth/csrf') return json({ headerName: 'X-CSRF-TOKEN', token: 'csrf-signup' });
    assert.equal(path, '/api/auth/signup');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'csrf-signup');
    assert.deepEqual(JSON.parse(init.body), buildSignupInput(form, documents, accepted));
    return json({ id: '9007199254740993', email: 'reader@example.test', nickname: '시연 회원' }, 201);
  });
  try {
    await client.refresh();
    const shown = await client.signupDocuments();
    const result = await client.signup(buildSignupInput(form, shown, Object.fromEntries(shown.map(doc => [doc.kind, doc]))));
    assert.equal(result.id, '9007199254740993');
    assert.equal(client.getSnapshot().status, 'anonymous');
    assert.equal(client.getSnapshot().member, null);
    assert.deepEqual(calls, ['/api/auth/session', '/api/auth/terms', '/api/auth/csrf', '/api/auth/signup']);
  } finally {
    client.dispose();
  }
});

test('서버가 정한 가입 오류만 화면 필드로 전달합니다.', async () => {
  const client = createMemberSessionClient('https://test.example', async input => {
    if (new URL(input).pathname === '/api/auth/csrf') return json({ headerName: 'X-CSRF-TOKEN', token: 'signup' });
    return json({ message: '가입 정보를 확인해 주세요.', fieldErrors: { email: '이미 사용 중인 이메일입니다.', role: 'forged', nickname: {} } }, 409);
  });
  try {
    await assert.rejects(client.signup(buildSignupInput(form, documents, accepted)), error => {
      assert.ok(error instanceof SignupProblem);
      assert.equal(error.status, 409);
      assert.deepEqual(error.fields, { email: '이미 사용 중인 이메일입니다.' });
      return true;
    });
    assert.equal(parseSignupProblem(400, null).status, 400);
  } finally {
    client.dispose();
  }
});

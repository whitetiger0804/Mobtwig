'use strict';

const byId = (id) => document.getElementById(id);
const notice = byId('notice');
const kindNames = { book: '도서', magazine: '매거진', novel: '웹소설' };
const statusNames = { DRAFT: '비공개 초안', PENDING_REVIEW: '승인 대기', PUBLISHED: '공개', REJECTED: '반려', HIDDEN: '숨김' };
let catalog;
let busy = false;
let chapterSequence = 0;
let noticeTimer;

/** 처리 결과를 화면의 알림 영역에 표시합니다. */
function message(text, isError = false) {
  clearTimeout(noticeTimer);

  notice.textContent = text;
  notice.dataset.level = isError ? 'error' : 'success';
  notice.hidden = false;

  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 3000);
}

/** HTTP 실패를 상태 코드와 함께 전달하며 성공 응답만 반환합니다. */
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    const payload = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
    const descriptions = {
      400: '입력값을 확인하십시오.', 401: '로그인이 필요하거나 인증정보가 올바르지 않습니다.',
      403: '관리자 권한 또는 요청 인증정보를 확인하십시오.', 404: '요청한 자료를 찾을 수 없습니다.',
      409: '이미 등록된 값이거나 현재 자료와 충돌합니다.',
    };
    const detail = payload?.message || payload?.detail || descriptions[response.status] || '서버에서 요청을 처리하지 못했습니다.';
    const error = new Error(`${detail} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

/** 각 변경 요청에 현재 세션의 CSRF 토큰을 사용합니다. */
async function post(path, body, formEncoded = false) {
  const csrf = await request('/api/admin/csrf');
  return request(path, {
    method: 'POST',
    headers: { [csrf.headerName]: csrf.token, 'Content-Type': formEncoded ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: formEncoded ? new URLSearchParams(body) : JSON.stringify(body),
  });
}

/** 요청 중 화면의 중복 제출을 막습니다. */
async function perform(action) {
  if (busy) return;
  busy = true;
  byId('main').setAttribute('aria-busy', 'true');
  document.querySelectorAll('button, input, textarea, select').forEach((control) => { control.disabled = true; });
  try {
    await action();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      showLogin();
      if (error.status === 403) byId('logout').hidden = false;
    }
    message(error instanceof TypeError ? '서버에 연결하지 못했습니다. 연결 상태를 확인하십시오.' : error.message, true);
  } finally {
    busy = false;
    byId('main').setAttribute('aria-busy', 'false');
    document.querySelectorAll('button, input, textarea, select').forEach((control) => { control.disabled = false; });
  }
}

/** 입력된 값은 버튼을 비활성화하기 전에 읽습니다. */
function onSubmit(id, action) {
  const form = byId(id);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity() || busy) return;
    const data = new FormData(form);
    perform(() => action(data, form));
  });
}

/** 인증이 필요한 화면과 비밀번호 입력을 정리합니다. */
function showLogin() {
  byId('workspace').hidden = true;
  byId('login-panel').hidden = false;
  byId('identity').textContent = '';
  byId('logout').hidden = true;
  document.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
}

/** 로그인한 관리자의 신원을 확인한 뒤 등록 자료를 읽습니다. */
async function loadWorkspace() {
  const member = await request('/api/admin/session');
  byId('identity').textContent = `${member.nickname} (${member.email})`;
  byId('workspace').hidden = false;
  byId('login-panel').hidden = true;
  byId('logout').hidden = false;
  await loadCatalog();
}

/** 기존 선택을 유지하면서 서버의 실제 선택 항목으로 교체합니다. */
function fillOptions(id, items, describe, single = false) {
  const select = byId(id);
  const selected = new Set(Array.from(select.selectedOptions, (option) => option.value));
  select.replaceChildren();
  if (single) {
    const placeholder = new Option('작품을 선택하십시오.', '');
    placeholder.selected = selected.size === 0 || selected.has('');
    select.add(placeholder);
  }
  for (const item of items) {
    const option = new Option(describe(item), String(item.id));
    option.selected = selected.has(String(item.id));
    select.add(option);
  }
}

/** 저자·분류·작품 목록을 사용자 데이터의 HTML 해석 없이 표시합니다. */
async function loadCatalog() {
  catalog = await request('/api/admin/catalog');
  fillOptions('work-authors', catalog.authors, (item) => item.name);
  fillOptions('work-genres', catalog.genres, (item) => item.name);
  fillOptions('work-categories', catalog.categories, (item) => item.name);
  for (const id of ['status-work', 'chapter-work']) {
    fillOptions(id, catalog.works, (item) => `${item.title} (${item.slug})`, true);
  }
  const rows = catalog.works.map((work) => {
    const row = document.createElement('tr');
    for (const value of [work.title, work.slug, kindNames[work.kind], statusNames[work.publishStatus]]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  });
  byId('works-body').replaceChildren(...rows);
  byId('works-empty').hidden = rows.length > 0;
  byId('works-table').hidden = rows.length === 0;
}

/** 저장 후 목록 갱신만 실패한 경우 저장 완료 사실을 함께 전달합니다. */
async function refreshAfterSave(savedMessage) {
  try {
    await loadCatalog();
  } catch (error) {
    const detail = error instanceof TypeError ? '서버 연결 상태를 확인하십시오.' : error.message;
    const failure = new Error(`${savedMessage} 목록 갱신에 실패했습니다. 같은 요청을 다시 제출하지 말고 목록을 새로고침하십시오. ${detail}`);
    failure.status = error.status;
    throw failure;
  }
  message(savedMessage);
}

/** 선택 문자열과 수치를 미입력 시 null로 변환합니다. */
const optionalText = (value) => value.trim() || null;
const optionalNumber = (value) => value === '' ? null : Number(value);

/** 회차 입력의 레이블과 입력 ID가 서로 대응하도록 생성합니다. */
function addChapter(container, removable) {
  const row = byId('chapter-template').content.firstElementChild.cloneNode(true);
  const prefix = `chapter-${++chapterSequence}`;
  for (const input of row.querySelectorAll('input, textarea')) {
    input.id = `${prefix}-${input.name}`;
    row.querySelector(`[data-label-for="${input.name}"]`).htmlFor = input.id;
  }
  const remove = row.querySelector('.remove-chapter');
  remove.hidden = !removable;
  remove.addEventListener('click', () => {
    if (container.children.length === 1) {
      message('작품에는 회차를 한 개 이상 등록하십시오.', true);
      return;
    }
    row.remove();
    numberChapterRows(container);
  });
  container.append(row);
  numberChapterRows(container);
}

/** 화면에 표시하는 회차 입력 번호를 갱신합니다. */
function numberChapterRows(container) {
  Array.from(container.children).forEach((row, index) => {
    row.querySelector('legend').textContent = `회차 입력 ${index + 1}`;
  });
}

/** 공개 시각을 UTC로 변환하고 회차의 조건부 필수값을 확인합니다. */
function readChapter(row, kind) {
  const value = (name) => row.querySelector(`[name="${name}"]`).value;
  const published = value('chapterPublishedAt');
  const contentUrl = optionalText(value('contentUrl'));
  const pageNumber = optionalNumber(value('pageNumber'));
  if (published && !contentUrl) throw new Error('회차 공개 시각을 입력하면 본문 주소도 입력하십시오.');
  if (kind === 'magazine' && pageNumber === null) throw new Error('매거진 회차에는 시작 쪽수를 입력하십시오.');
  return {
    chapterNo: Number(value('chapterNo')), title: value('chapterTitle').trim(),
    publishedAt: published ? new Date(published).toISOString() : null,
    characterCount: Number(value('characterCount')), summary: optionalText(value('chapterSummary')),
    category: optionalText(value('chapterCategory')), pageNumber, contentUrl,
  };
}

onSubmit('login-form', async (data) => {
  const password = data.get('password');
  byId('password').value = '';
  await post('/api/admin/login', { username: data.get('username').trim(), password }, true);
  await loadWorkspace();
  message('로그인했습니다.');
});

byId('logout').addEventListener('click', () => perform(async () => {
  await post('/api/admin/logout', {});
  showLogin();
  message('로그아웃했습니다.');
}));

onSubmit('author-form', async (data, form) => {
  await post('/api/admin/authors', { name: data.get('name').trim(), bio: optionalText(data.get('bio')), field: optionalText(data.get('field')) });
  form.reset();
  await refreshAfterSave('저자를 등록했습니다.');
});

onSubmit('genre-form', async (data, form) => {
  await post('/api/admin/genres', { name: data.get('name').trim(), displayOrder: Number(data.get('displayOrder')) });
  form.reset();
  await refreshAfterSave('장르를 등록했습니다.');
});

onSubmit('category-form', async (data, form) => {
  await post('/api/admin/categories', { name: data.get('name').trim(), description: optionalText(data.get('description')), displayOrder: Number(data.get('displayOrder')) });
  form.reset();
  await refreshAfterSave('카테고리를 등록했습니다.');
});

onSubmit('work-form', async (data, form) => {
  const authorIds = data.getAll('authorIds').map(Number);
  const genreIds = data.getAll('genreIds').map(Number);
  const categoryIds = data.getAll('categoryIds').map(Number);
  if (!authorIds.length || !genreIds.length && !categoryIds.length) throw new Error('저자를 한 명 이상, 장르·카테고리를 합쳐 한 개 이상 선택하십시오.');
  const kind = data.get('kind');
  const chapters = Array.from(byId('work-chapters').children, (row) => readChapter(row, kind));
  const result = await post('/api/admin/works', {
    kind, slug: data.get('slug').trim(), title: data.get('title').trim(), description: data.get('description').trim(),
    imageUrl: data.get('imageUrl').trim(), publishedAt: data.get('publishedAt'), publisher: data.get('publisher').trim(),
    fileFormat: data.get('fileFormat').trim(), pageCount: optionalNumber(data.get('pageCount')),
    issue: optionalText(data.get('issue')), publicationCycle: optionalText(data.get('publicationCycle')),
    serialStatus: data.get('serialStatus'), publishStatus: data.get('publishStatus'), authorIds, genreIds, categoryIds, chapters,
  });
  form.reset();
  byId('work-chapters').replaceChildren();
  addChapter(byId('work-chapters'), true);
  await refreshAfterSave(`작품을 등록했습니다. 식별자: ${result.slug}`);
});

onSubmit('chapter-form', async (data, form) => {
  const work = catalog.works.find((item) => String(item.id) === data.get('workId'));
  if (!work) throw new Error('회차를 추가할 작품을 선택하십시오.');
  const chapter = readChapter(byId('single-chapter').firstElementChild, work.kind);
  await post(`/api/admin/works/${encodeURIComponent(work.id)}/chapters`, chapter);
  form.reset();
  message('회차를 등록했습니다.');
});

onSubmit('status-form', async (data) => {
  await post(`/api/admin/works/${encodeURIComponent(data.get('workId'))}/status`, { publishStatus: data.get('publishStatus') });
  await refreshAfterSave('작품 공개 상태를 변경했습니다.');
});

onSubmit('account-form', async (data, form) => {
  const password = data.get('password');
  byId('account-password').value = '';
  if (new TextEncoder().encode(password).length > 72) throw new Error('비밀번호는 UTF-8 기준 72바이트 이하로 입력하십시오.');
  await post('/api/admin/accounts', { email: data.get('email').trim(), nickname: data.get('nickname').trim(), password });
  form.reset();
  message('관리자 계정을 추가했습니다.');
});

byId('add-work-chapter').addEventListener('click', () => addChapter(byId('work-chapters'), true));
byId('refresh').addEventListener('click', () => perform(async () => {
  await loadCatalog();
  message('목록을 새로 불러왔습니다.');
}));

addChapter(byId('work-chapters'), true);
addChapter(byId('single-chapter'), false);
perform(async () => {
  try {
    await loadWorkspace();
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) throw error;
    showLogin();
    if (error.status === 403) {
      byId('logout').hidden = false;
      message('관리자 권한이 없는 계정입니다. 로그아웃 후 허용된 계정으로 로그인하십시오.', true);
    }
  }
});

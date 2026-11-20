import { landingWorkId, publicWork } from './work.js';

const element = id => document.getElementById(id);
const status = element('status');
const retry = element('retry');
const workId = landingWorkId(location.pathname);
element('address').textContent = workId ? location.origin + '/s/works/' + workId : '';

async function load() {
  retry.hidden = true;
  status.textContent = '작품 정보를 불러오고 있습니다.';
  if (!workId) {
    status.textContent = '올바른 모북이 작품 링크가 아닙니다.';
    return;
  }
  try {
    // 이 페이지에서 한 번만 조회한다. 실패했을 때 사용자가 재시도할 수 있다.
    const response = await fetch('/works/' + workId, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (response.status === 404) {
      status.textContent = '공개된 작품이 없습니다.';
      return;
    }
    if (!response.ok) throw new Error('work unavailable');
    const work = publicWork(await response.json(), workId, location.origin);
    element('work-title').textContent = work.title;
    element('author').textContent = work.author;
    element('kind').textContent = { book: '도서', magazine: '매거진', novel: '웹소설' }[work.kind];
    element('cover').src = work.imageUrl;
    element('cover').alt = work.title + ' 표지';
    const open = element('open-app');
    open.href = 'mobtwig://works/' + workId;
    open.hidden = false;
    element('work').hidden = false;
    status.hidden = true;
    document.title = work.title + ' · 모북이';
  } catch {
    status.textContent = '작품 정보를 불러오지 못했습니다. 다시 시도해 주세요.';
    retry.hidden = false;
  }
}

retry.addEventListener('click', () => void load());
void load();

import { shareOrigin } from './workSharing.ts';

/** URL을 경로 정규화하기 전에 검사하여 다른 origin·인코딩된 경로·인증 정보를 거절합니다. */
export function parseWorkLink(value: string, baseUrl?: string): string | null {
  if (value.length > 2048 || /[\s\\%?#]/.test(value)) return null;
  const custom = /^mobtwig:\/\/works\/([a-z0-9-]{1,120})$/.exec(value);
  if (custom) return custom[1];
  try {
    const origin = shareOrigin(baseUrl);
    if (!value.startsWith(origin + '/s/works/')) return null;
    const path = value.slice(origin.length);
    return /^\/s\/works\/([a-z0-9-]{1,120})$/.exec(path)?.[1] ?? null;
  } catch { return null; }
}

/**
 * 초기 URL을 기다리는 동안 수신한 새 링크가 초기 URL에 덮이지 않도록 구독합니다.
 * Expo 개발 런처 주소는 초기 작품 링크로 해석하지 않습니다.
 */
export function observeWorkLinks(source: {
  addEventListener(type: 'url', listener: (event: { url: string }) => void): { remove(): void };
  getInitialURL(): Promise<string | null | undefined>;
}, update: (target: { workId: string | null; sequence: number } | null) => void, baseUrl?: string) {
  let active = true;
  let sequence = 0;
  const receive = ({ url }: { url: string }) => {
    if (active) update({ workId: parseWorkLink(url, baseUrl), sequence: ++sequence });
  };
  const subscription = source.addEventListener('url', receive);
  source.getInitialURL().then(url => {
    if (!active || sequence !== 0) return;
    let shared = !!url && url.startsWith('mobtwig:');
    try { shared ||= !!url && url.startsWith(shareOrigin(baseUrl) + '/s/'); } catch { /* 별도 공유 설정 오류는 링크 오류 화면에서 처리합니다. */ }
    update(shared && url ? { workId: parseWorkLink(url, baseUrl), sequence: ++sequence } : null);
  }).catch(() => {
    if (active && sequence === 0) update({ workId: null, sequence: ++sequence });
  });
  return () => { active = false; subscription.remove(); };
}

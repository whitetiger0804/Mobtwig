/** API 서버 선택과 별개로 외부에 전달하는 공개 서비스 주소입니다. */
export const defaultShareBaseUrl = 'https://mobtwig.xn--3h3b098b.kro.kr';

/** 경로·인증 정보가 없는 공유 origin을 검증합니다. */
export function shareOrigin(value = defaultShareBaseUrl): string {
  if (!/^https?:\/\/[^\s\\]+$/i.test(value)) throw new Error('공유 주소 설정을 확인해 주세요.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('공유 주소 설정을 확인해 주세요.');
  }
  return url.origin;
}

/** 공개 작품 slug로 웹 안내 주소와 공유 문구를 만듭니다. 문장은 URL에 넣지 않습니다. */
export function workShare(workId: string, title: string | undefined, excerpt: string | undefined, baseUrl?: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(workId)) throw new Error('공유할 작품을 확인해 주세요.');
  const url = shareOrigin(baseUrl) + '/s/works/' + workId;
  const workTitle = title?.trim() || workId;
  const text = [excerpt, workTitle, url].filter(Boolean).join('\n\n');
  return { url, title: workTitle, message: text };
}

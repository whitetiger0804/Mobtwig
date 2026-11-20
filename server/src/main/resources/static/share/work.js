/** 정확한 공유 경로의 slug만 사용하며 쿼리에 포함된 제목·문장은 읽지 않습니다. */
export function landingWorkId(pathname) {
  return /^\/s\/works\/([a-z0-9-]{1,120})$/.exec(pathname)?.[1] ?? null;
}

/** 사용자 콘텐츠는 textContent에 전달하고 표지에는 검증된 HTTP(S) 주소만 사용합니다. */
export function publicWork(value, workId, origin) {
  if (!value || value.id !== workId || !['book', 'magazine', 'novel'].includes(value.kind)
      || typeof value.title !== 'string' || !value.title.trim()
      || typeof value.author !== 'string' || !value.author.trim()
      || typeof value.imageUrl !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value.imageUrl)
      || !/^https?:\/\//i.test(value.imageUrl) && !/^\/(?!\/)/.test(value.imageUrl)) {
    throw new Error('Invalid public work');
  }
  const image = new URL(value.imageUrl, origin);
  if (image.username || image.password || !['http:', 'https:'].includes(image.protocol)) throw new Error('Invalid cover URL');
  return { id: value.id, title: value.title, author: value.author, kind: value.kind, imageUrl: image.href };
}

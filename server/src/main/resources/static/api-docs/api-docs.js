'use strict';

SwaggerUIBundle({
  url: '/openapi.yaml',
  dom_id: '#swagger-ui',
  presets: [SwaggerUIBundle.presets.apis],
  layout: 'BaseLayout',
  deepLinking: true,
  validatorUrl: null,
  withCredentials: true,
  persistAuthorization: false,
  /** 같은 서버에만 요청하고 관리자 변경 요청마다 현재 세션의 CSRF 토큰을 사용합니다. */
  requestInterceptor: async (request) => {
    const target = new URL(request.url, window.location.origin);
    if (target.origin !== window.location.origin) {
      throw new Error('이 문서를 제공한 서버의 API 주소를 사용하십시오.');
    }
    if (request.method === 'POST' && target.pathname.startsWith('/api/admin/')) {
      const response = await fetch('/api/admin/csrf', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`CSRF 토큰을 받지 못했습니다. HTTP ${response.status}`);
      const csrf = await response.json();
      request.headers[csrf.headerName] = csrf.token;
    }
    return request;
  },
});

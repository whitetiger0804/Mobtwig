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
  /** 같은 서버에서 요청의 인증 영역과 일치하는 현재 CSRF 토큰을 사용합니다. */
  requestInterceptor: async (request) => {
    const target = new URL(request.url, window.location.origin);
    if (target.origin !== window.location.origin) {
      throw new Error('이 문서를 제공한 서버의 API 주소를 사용하십시오.');
    }
    const scope = target.pathname.startsWith('/api/admin/') ? 'admin' : target.pathname.startsWith('/api/auth/') ? 'auth' : null;
    if (request.method === 'POST' && scope) {
      const response = await fetch(`/api/${scope}/csrf`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`CSRF 토큰을 받지 못했습니다. HTTP ${response.status}`);
      const csrf = await response.json();
      if (csrf.headerName !== 'X-CSRF-TOKEN' || typeof csrf.token !== 'string' || !csrf.token) throw new Error('CSRF 응답 형식을 확인하십시오.');
      request.headers[csrf.headerName] = csrf.token;
    }
    return request;
  },
});

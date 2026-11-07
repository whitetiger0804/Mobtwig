import { parseSignupDocuments, parseSignupProblem, parseSignupResult, type SignupDocument, type SignupInput, type SignupResult } from './memberSignup.ts';

/** 서버가 현재 활성 회원에게만 제공하는 공개 계정 정보입니다. */
export interface MemberIdentity {
  /** 정밀도 손실을 피하기 위해 문자열로 받는 회원 ID입니다. */
  id: string;
  /** 서버가 정리한 로그인 이메일입니다. */
  email: string;
  /** 현재 회원의 표시 이름입니다. */
  nickname: string;
  /** 서버의 ISO 8601 가입 시각입니다. */
  createdAt: string;
}

/** 회원 정보와 요청의 소속 세대를 함께 나타냅니다. */
export interface MemberAuthState {
  /** 확인 전·로그아웃·인증·확인 실패를 구분합니다. */
  status: 'checking' | 'anonymous' | 'authenticated' | 'error';
  /** 인증을 확인한 경우에만 존재하는 현재 회원입니다. */
  member: Readonly<MemberIdentity> | null;
  /** 이전 계정의 요청·캐시를 구분하는 증가 값입니다. */
  generation: number;
  /** 민감한 응답 원문을 포함하지 않는 안내입니다. */
  error: string | null;
}

/** 쿠키는 플랫폼이 관리하며 JS 저장소에 직접 보관하지 않습니다. */
export interface MemberSessionClient {
  /** 현재 메모리 상태를 읽습니다. */
  getSnapshot(): Readonly<MemberAuthState>;
  /**
   * 회원 상태 변경을 구독합니다.
   * @param listener - 새 상태를 읽어 화면에 반영할 함수입니다.
   * @returns 해당 구독만 해제하는 함수입니다.
   */
  subscribe(listener: () => void): () => void;
  /** 현재 쿠키로 세션을 다시 확인하며 네트워크 실패를 인증 성공으로 간주하지 않습니다. */
  refresh(): Promise<void>;
  /** 현재 가입에 필요한 시연 문서를 확인합니다. */
  signupDocuments(): Promise<SignupDocument[]>;
  /**
   * CSRF 토큰과 동의한 문서를 보내고 가입 결과를 확인합니다.
   * @param input - 화면에서 확인한 회원 입력과 문서 정보입니다.
   * @returns 가입 결과이며 인증 상태는 변경하지 않습니다.
   */
  signup(input: SignupInput): Promise<SignupResult>;
  /**
   * 이전 회원 세션을 먼저 종료한 다음 새 계정의 인증을 확인합니다.
   * @param email - 로그인 이메일입니다.
   * @param password - 메서드가 끝난 뒤 보관하지 않는 입력 비밀번호입니다.
   * @returns 서버가 확인한 현재 회원입니다.
   */
  login(email: string, password: string): Promise<MemberIdentity>;
  /** 서버의 종료 응답을 확인하지 못하면 성공으로 표시하지 않습니다. */
  logout(): Promise<void>;
  /**
   * 소유자 ID를 클라이언트에서 대체하지 않는 회원 전용 경로를 요청합니다.
   * @param path - 같은 서버의 `/api/members/` 하위 상대 경로입니다.
   * @param init - 메서드·본문 등 요청 옵션입니다. 쿠키와 취소 신호는 내부에서 관리합니다.
   * @returns 현재 인증 세대에서 검증한 JSON이며 204이면 null입니다.
   */
  request(path: string, init?: RequestInit): Promise<unknown>;
  /** 요청과 구독을 정리하고 더 이상 이 클라이언트의 응답을 사용하지 않습니다. */
  dispose(): void;
}

/**
 * 세션 응답을 검증하고 내부 ID·역할·임의 성공 응답을 회원 정보로 사용하지 않습니다.
 * @param value - 미검증 서버 JSON입니다.
 * @returns 비밀번호·세션 ID를 포함하지 않는 회원 정보입니다.
 */
export function parseMemberIdentity(value: unknown): MemberIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('회원 정보의 형식이 올바르지 않습니다.');
  const member = value as Record<string, unknown>;
  if (typeof member.id !== 'string' || !/^-?[1-9][0-9]*$/.test(member.id)
      || typeof member.email !== 'string' || !member.email.includes('@') || member.email.length > 255
      || typeof member.nickname !== 'string' || !member.nickname.trim() || member.nickname.length > 30
      || typeof member.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(member.createdAt) || !Number.isFinite(Date.parse(member.createdAt)) || new Date(member.createdAt).toISOString().slice(0, 19) !== member.createdAt.slice(0, 19)) {
    throw new Error('회원 정보의 형식이 올바르지 않습니다.');
  }
  return { id: member.id, email: member.email, nickname: member.nickname, createdAt: member.createdAt };
}

/**
 * 같은 사이트의 쿠키 인증과 native 플랫폼 쿠키 저장소를 사용하는 클라이언트를 만듭니다.
 * @param apiUrl - 사용자 정보·쿼리·해시가 없는 HTTP(S) API 기준 주소입니다.
 * @param requester - 기본 Fetch API이며 HTTP 계약 검사에서는 쿠키 저장소를 주입할 수 있습니다.
 * @returns 서버/회원 전환 시 폐기하는 메모리 전용 인증 클라이언트입니다.
 */
export function createMemberSessionClient(apiUrl: string, requester: typeof fetch = fetch): MemberSessionClient {
  const url = new URL(apiUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API 주소를 확인해 주십시오.');
  }
  const base = apiUrl.replace(/\/+$/, '');
  let state: Readonly<MemberAuthState> = Object.freeze({ status: 'checking', member: null, generation: 0, error: null });
  let generation = 0, refreshSequence = 0, busy = false, disposed = false;
  const listeners = new Set<() => void>(), requests = new Set<AbortController>();
  const canceled = () => { const error = new Error('이전 회원의 요청이 취소됐습니다.'); error.name = 'AbortError'; return error; };
  const assertCurrent = (epoch: number) => { if (disposed || epoch !== generation) throw canceled(); };
  const publish = (next: MemberAuthState) => {
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const forget = (status: MemberAuthState['status'], error: string | null = null) => {
    generation++;
    for (const controller of requests) controller.abort();
    requests.clear();
    publish({ status, member: null, generation, error });
    return generation;
  };

  async function consumeRequest<T>(path: string, epoch: number, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    assertCurrent(epoch);
    const controller = new AbortController(); requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await requester(base + path, { ...init, credentials: 'include', signal: controller.signal });
      assertCurrent(epoch); const result = await consume(response); assertCurrent(epoch); return result;
    } finally { clearTimeout(timer); requests.delete(controller); }
  }

  const send = (path: string, epoch: number, init: RequestInit = {}) => consumeRequest(path, epoch, init, async response => response);

  async function csrf(epoch: number): Promise<string> {
    return consumeRequest('/api/auth/csrf', epoch, {}, async response => {
    if (!response.ok) throw new Error('보안 확인 정보를 받지 못했습니다. 다시 시도해 주십시오.');
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('보안 확인 응답이 올바르지 않습니다.'); }
    assertCurrent(epoch);
    if (!value || typeof value !== 'object' || !('token' in value) || typeof value.token !== 'string' || !value.token
        || !('headerName' in value) || value.headerName !== 'X-CSRF-TOKEN') throw new Error('보안 확인 응답이 올바르지 않습니다.');
    return value.token;
    });
  }

  async function mutate(path: string, epoch: number, init: RequestInit = {}): Promise<Response> {
    const token = await csrf(epoch);
    const headers = new Headers(init.headers); headers.set('X-CSRF-TOKEN', token);
    return send(path, epoch, { ...init, method: init.method ?? 'POST', headers });
  }

  async function readIdentity(epoch: number): Promise<MemberIdentity | null> {
    return consumeRequest('/api/auth/session', epoch, {}, async response => {
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 시도해 주십시오.');
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('회원 정보의 형식이 올바르지 않습니다.'); }
    assertCurrent(epoch); return parseMemberIdentity(value);
    });
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async signupDocuments() {
      return consumeRequest('/api/auth/terms', generation, {}, async response => {
        if (response.status === 503) throw new Error('이 환경에서는 시연 회원가입을 제공하지 않습니다.');
        if (!response.ok) throw new Error('가입 문서를 불러오지 못했습니다.');
        return parseSignupDocuments(await response.json().catch(() => null));
      });
    },
    async signup(input) {
      if (busy) throw new Error('인증 요청을 처리하고 있습니다.');
      const epoch = generation;
      assertCurrent(epoch);
      busy = true;
      try {
        const token = await csrf(epoch);
        return await consumeRequest('/api/auth/signup', epoch, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
          body: JSON.stringify(input),
        }, async response => {
          if (response.status === 201) return parseSignupResult(await response.json());
          if ([400, 409, 503].includes(response.status)) {
            const body: unknown = await response.json().catch(() => null);
            throw parseSignupProblem(response.status, body);
          }
          throw new Error(response.status === 403 ? '보안 확인에 실패했습니다. 다시 시도해 주세요.' : '가입을 처리하지 못했습니다. 다시 시도해 주세요.');
        });
      } finally {
        busy = false;
      }
    },
    async refresh() {
      if (busy || disposed) return;
      const epoch = generation, sequence = ++refreshSequence;
      try {
        const member = await readIdentity(epoch);
        assertCurrent(epoch); if (sequence !== refreshSequence) return;
        if (!member) { if (state.member) forget('anonymous'); else publish({ status: 'anonymous', member: null, generation, error: null }); return; }
        if (state.member && member.id !== state.member.id) forget('checking');
        publish({ status: 'authenticated', member: Object.freeze(member), generation, error: null });
      } catch {
        if (!disposed && generation === epoch && sequence === refreshSequence) forget('error', '로그인 상태를 확인하지 못했습니다. 다시 시도해 주십시오.');
      }
    },
    async login(email, password) {
      if (busy) throw new Error('인증 요청을 처리하고 있습니다.');
      if (disposed) throw canceled();
      busy = true; const epoch = forget('checking');
      try {
        const ended = await mutate('/api/auth/logout', epoch);
        if (ended.status !== 204) throw new Error('이전 계정의 로그아웃을 확인하지 못했습니다. 다시 시도해 주십시오.');
        const response = await mutate('/api/auth/login', epoch, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: email.trim(), password }).toString() });
        if (response.status !== 204) throw new Error(response.status === 401 ? '이메일 또는 비밀번호를 확인해 주십시오.' : '로그인하지 못했습니다. 다시 시도해 주십시오.');
        const member = await readIdentity(epoch);
        if (!member) throw new Error('로그인 상태를 확인하지 못했습니다. 다시 시도해 주십시오.');
        assertCurrent(epoch); publish({ status: 'authenticated', member: Object.freeze(member), generation, error: null });
        return member;
      } catch (error) {
        if (!disposed && generation === epoch) publish({ status: 'anonymous', member: null, generation, error: error instanceof Error ? error.message : '로그인하지 못했습니다.' });
        throw error;
      } finally { busy = false; }
    },
    async logout() {
      if (busy) throw new Error('인증 요청을 처리하고 있습니다.');
      if (disposed) throw canceled();
      busy = true; const epoch = forget('checking');
      try {
        const response = await mutate('/api/auth/logout', epoch);
        if (response.status !== 204) throw new Error('로그아웃 완료를 확인하지 못했습니다. 다시 시도해 주십시오.');
        assertCurrent(epoch); publish({ status: 'anonymous', member: null, generation, error: null });
      } catch (error) {
        if (!disposed && generation === epoch) publish({ status: 'error', member: null, generation, error: '로그아웃 완료를 확인하지 못했습니다. 다시 시도해 주십시오.' });
        throw error;
      } finally { busy = false; }
    },
    async request(path, init = {}) {
      if (!path.startsWith('/api/members/') || /[\\\u0000-\u0020#]/.test(path) || /%2e|%2f|%5c/i.test(path.split('?')[0]) || path.split('/').includes('..')
          || !new URL(base + path).pathname.startsWith(url.pathname.replace(/\/+$/, '') + '/api/members/')) throw new Error('회원 요청 경로를 확인해 주십시오.');
      if (state.status !== 'authenticated') throw new Error('로그인이 필요합니다.');
      const epoch = generation;
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-TOKEN', await csrf(epoch));
      return consumeRequest(path, epoch, { ...init, headers }, async response => {
        if (response.status === 401) { assertCurrent(epoch); forget('anonymous'); throw new Error('로그인이 만료됐습니다. 다시 로그인해 주십시오.'); }
        if (!response.ok) throw new Error('회원 요청을 처리하지 못했습니다. (HTTP ' + response.status + ')');
        if (response.status === 204) return null;
        try { return await response.json(); } catch { throw new Error('회원 응답의 형식이 올바르지 않습니다.'); }
      });
    },
    dispose() {
      disposed = true; generation++;
      for (const controller of requests) controller.abort();
      requests.clear(); listeners.clear();
      state = Object.freeze({ status: 'anonymous', member: null, generation, error: null });
    },
  };
}

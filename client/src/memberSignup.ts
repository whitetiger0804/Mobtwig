/** 가입할 때 확인할 필수 문서의 종류입니다. */
export type SignupDocumentKind = 'TERMS' | 'PRIVACY';

/** 서버가 표시용으로 제공하는 시연 문서입니다. */
export interface SignupDocument {
  /** 이용약관 또는 개인정보 수집·이용 동의입니다. */
  kind: SignupDocumentKind;
  /** 동의 대상 버전입니다. */
  version: string;
  /** 화면에 표시할 제목입니다. */
  title: string;
  /** 서버 원문 그대로 표시하는 텍스트입니다. */
  body: string;
  /** UTF-8 원문의 SHA-256 해시입니다. */
  contentHash: string;
  /** 시연에만 사용하는 문서 표시입니다. */
  temporary: true;
}

/** 가입 화면의 입력입니다. */
export interface SignupForm {
  /** 로그인에 사용할 이메일입니다. */
  email: string;
  /** 앱에서 표시할 닉네임입니다. */
  nickname: string;
  /** 가공 없이 확인할 비밀번호입니다. */
  password: string;
  /** 같은 값을 입력했는지 확인할 비밀번호입니다. */
  passwordConfirmation: string;
}

/** 현재 표시한 문서에 대한 명시적 동의입니다. */
export interface SignupConsent {
  /** 동의할 문서 종류입니다. */
  kind: SignupDocumentKind;
  /** 화면에 표시한 버전입니다. */
  version: string;
  /** 화면에 표시한 원문의 해시입니다. */
  contentHash: string;
  /** 체크한 경우에만 보냅니다. */
  agreed: true;
}

/** CSRF로 보호하는 가입 요청입니다. */
export interface SignupInput extends SignupForm {
  /** 필수 문서 두 종류에 대한 동의입니다. */
  consents: SignupConsent[];
}

/** 가입 성공 응답에 포함되는 표시 정보입니다. */
export interface SignupResult {
  /** 정밀도 손실을 피하도록 문자열로 받는 신규 회원 ID입니다. */
  id: string;
  /** 로그인 입력란에 전달할 정규화된 이메일입니다. */
  email: string;
  /** 새 계정의 표시 이름입니다. */
  nickname: string;
}

/** 가입 오류를 표시하는 위치입니다. */
export type SignupField = keyof SignupForm | 'terms' | 'privacy' | 'request';

/** 입력 아래에 표시할 가입 오류입니다. */
export type SignupFields = Partial<Record<SignupField, string>>;

/** 체크한 문서의 버전·해시를 보관하는 화면 상태입니다. */
export type SignupAcceptance = Partial<Record<SignupDocumentKind, SignupDocument>>;

/** 서버 또는 화면 검증에서 확인한 가입 오류입니다. */
export class SignupProblem extends Error {
  /** 입력 오류는 400, 중복 또는 문서 변경은 409, 사용 중지는 503입니다. */
  readonly status: number;
  /** 검증을 통과한 필드별 오류입니다. */
  readonly fields: SignupFields;

  /**
   * 입력값 대신 안내와 오류 위치를 담습니다.
   * @param status - 확인한 HTTP 상태입니다.
   * @param message - 화면에 표시할 안내입니다.
   * @param fields - 해당 필드만 포함하는 오류입니다.
   */
  constructor(status: number, message: string, fields: SignupFields = {}) {
    super(message);
    this.name = 'SignupProblem';
    this.status = status;
    this.fields = fields;
  }
}

const kinds: SignupDocumentKind[] = ['TERMS', 'PRIVACY'];
const fields: SignupField[] = ['email', 'nickname', 'password', 'passwordConfirmation', 'terms', 'privacy', 'request'];
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * 현재 두 문서의 원문과 버전 정보를 검증합니다.
 * @param value - 서버의 미검증 JSON입니다.
 * @returns 이용약관과 개인정보 수집·이용 동의 문서입니다.
 */
export function parseSignupDocuments(value: unknown): SignupDocument[] {
  const documents = record(value)?.documents;
  const invalid = () => new Error('가입 문서 응답을 확인할 수 없습니다.');
  if (!Array.isArray(documents) || documents.length !== 2) throw invalid();
  return kinds.map(kind => {
    const matches = documents.filter(item => record(item)?.kind === kind);
    const doc = record(matches[0]);
    if (matches.length !== 1 || !doc || doc.temporary !== true
        || typeof doc.version !== 'string' || !doc.version || doc.version.length > 80
        || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 255
        || typeof doc.body !== 'string' || !doc.body.trim() || doc.body.includes('\r')
        || typeof doc.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(doc.contentHash)) throw invalid();
    return { kind, version: doc.version, title: doc.title, body: doc.body, contentHash: doc.contentHash, temporary: true };
  });
}

/**
 * 서버가 반환한 가입 결과에서 표시 정보만 받습니다.
 * @param value - 서버의 미검증 JSON입니다.
 * @returns 신규 회원의 표시 정보입니다.
 */
export function parseSignupResult(value: unknown): SignupResult {
  const result = record(value);
  if (!result || typeof result.id !== 'string' || !/^[1-9][0-9]*$/.test(result.id)
      || typeof result.email !== 'string' || !result.email.includes('@') || result.email.length > 255
      || typeof result.nickname !== 'string' || !result.nickname.trim() || result.nickname.length > 30) {
    throw new Error('가입 응답을 확인할 수 없습니다.');
  }
  return { id: result.id, email: result.email, nickname: result.nickname };
}

/**
 * 알려진 필드 오류만 가입 화면에 전달합니다.
 * @param status - 서버의 상태입니다.
 * @param value - 서버의 미검증 오류 응답입니다.
 * @returns 비정상 본문에도 기본 안내가 있는 가입 오류입니다.
 */
export function parseSignupProblem(status: number, value: unknown): SignupProblem {
  const result = record(value);
  const rawFields = record(result?.fieldErrors);
  const errors: SignupFields = {};
  for (const field of fields) {
    const message = rawFields?.[field];
    if (typeof message === 'string' && message.length > 0 && message.length <= 250) errors[field] = message;
  }
  const message = result?.message;
  return new SignupProblem(status, typeof message === 'string' && message.length > 0 && message.length <= 250
    ? message : '가입을 처리하지 못했습니다. 다시 시도해 주세요.', errors);
}

function utf8Length(value: string): number {
  let length = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return Infinity;
    length += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return length;
}

/**
 * 입력과 현재 화면에서 체크한 문서를 가입 요청에 담습니다.
 * @param form - 회원이 입력한 필드입니다.
 * @param documents - 현재 표시하는 문서입니다.
 * @param accepted - 회원이 체크한 정확한 버전·해시입니다.
 * @returns 서버에서 다시 검증할 가입 요청입니다.
 */
export function buildSignupInput(form: SignupForm, documents: readonly SignupDocument[], accepted: SignupAcceptance): SignupInput {
  const { password, passwordConfirmation } = form;
  const email = form.email.trim().toLowerCase();
  const nickname = form.nickname.trim();
  const errors: SignupFields = {};
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\x00-\x1f\x7f-\x9f]/.test(email) || utf8Length(email) === Infinity) {
    errors.email = '올바른 이메일을 입력해 주세요.';
  }
  if (!nickname || nickname.length > 30 || /[\x00-\x1f\x7f-\x9f]/.test(nickname) || utf8Length(nickname) === Infinity) {
    errors.nickname = '닉네임을 1~30자로 입력해 주세요.';
  }
  if ([...password].length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = '영문과 숫자를 포함한 비밀번호를 8자 이상 입력해 주세요.';
  } else if (utf8Length(password) > 72) {
    errors.password = '비밀번호는 UTF-8 기준 72바이트까지 입력할 수 있습니다.';
  }
  if (!passwordConfirmation || passwordConfirmation !== password) {
    errors.passwordConfirmation = '비밀번호 확인을 같은 값으로 입력해 주세요.';
  }
  const consents: SignupConsent[] = [];
  for (const kind of kinds) {
    const current = documents.find(document => document.kind === kind);
    const checked = accepted[kind];
    if (!current || !checked || current.version !== checked.version || current.contentHash !== checked.contentHash) {
      errors[kind === 'TERMS' ? 'terms' : 'privacy'] = '필수 문서를 확인하고 동의해 주세요.';
      continue;
    }
    consents.push({ kind, version: current.version, contentHash: current.contentHash, agreed: true });
  }
  if (Object.keys(errors).length) throw new SignupProblem(400, '가입 정보를 확인해 주세요.', errors);
  return { email, nickname, password, passwordConfirmation, consents };
}

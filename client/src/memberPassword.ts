/** 가공하지 않고 서버로 전달하는 비밀번호 변경 입력입니다. */
export interface PasswordChangeInput {
  /** 기존 비밀번호는 가입 정책을 다시 적용하지 않습니다. */
  currentPassword: string;
  /** 영문·숫자를 포함한 유니코드 8문자 이상, UTF-8 72바이트 이하입니다. */
  newPassword: string;
  /** 새 비밀번호와 정확히 같아야 합니다. */
  newPasswordConfirmation: string;
}

/** 비밀번호 입력 아래 또는 요청 안내에 표시하는 오류입니다. */
export type PasswordChangeFields = Partial<Record<keyof PasswordChangeInput | 'request', string>>;

/** 서버의 입력 오류와 화면 검증 오류에 공통으로 사용합니다. */
export class PasswordChangeProblem extends Error {
  readonly fields: PasswordChangeFields;
  constructor(fields: PasswordChangeFields) {
    super('비밀번호 변경 정보를 확인해 주세요.'); this.name = 'PasswordChangeProblem'; this.fields = fields;
  }
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return Infinity;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** 입력을 trim하지 않고 가입과 같은 신규 비밀번호 정책을 확인합니다. */
export function validatePasswordChange(input: PasswordChangeInput): PasswordChangeInput {
  const errors: PasswordChangeFields = {};
  if (!input.currentPassword || utf8Length(input.currentPassword) > 72) errors.currentPassword = '현재 비밀번호를 확인해 주세요.';
  if ([...input.newPassword].length < 8 || !/[A-Za-z]/.test(input.newPassword) || !/[0-9]/.test(input.newPassword)) {
    errors.newPassword = '영문과 숫자를 포함한 비밀번호를 8자 이상 입력해 주세요.';
  } else if (utf8Length(input.newPassword) > 72) errors.newPassword = '비밀번호는 UTF-8 기준 72바이트까지 입력할 수 있습니다.';
  else if (input.currentPassword === input.newPassword) errors.newPassword = '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
  if (!input.newPasswordConfirmation || input.newPasswordConfirmation !== input.newPassword) {
    errors.newPasswordConfirmation = '새 비밀번호 확인을 같은 값으로 입력해 주세요.';
  }
  if (Object.keys(errors).length) throw new PasswordChangeProblem(errors);
  return { currentPassword: input.currentPassword, newPassword: input.newPassword, newPasswordConfirmation: input.newPasswordConfirmation };
}

/** 알려진 필드의 안내만 사용하며 비밀번호·임의 서버 본문을 오류에 복사하지 않습니다. */
export function parsePasswordChangeProblem(value: unknown): PasswordChangeProblem {
  const fields: PasswordChangeFields = {};
  if (value && typeof value === 'object' && 'fieldErrors' in value && value.fieldErrors && typeof value.fieldErrors === 'object') {
    for (const key of ['currentPassword', 'newPassword', 'newPasswordConfirmation', 'request'] as const) {
      const message = (value.fieldErrors as Record<string, unknown>)[key];
      if (typeof message === 'string' && message.length > 0 && message.length <= 250) fields[key] = message;
    }
  }
  if (!Object.keys(fields).length) fields.request = '비밀번호 변경 정보를 확인해 주세요.';
  return new PasswordChangeProblem(fields);
}

// #region 의존성 가져오기
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useApp } from './appState';
import { EmptyState } from './EmptyState';
import { Action, colors, Icon, s } from './ui';
// #endregion

// #region 계정 화면의 공통 입력과 메뉴
/**
 * 계정 시안의 아이콘 입력란과 비밀번호 표시 전환을 구성합니다.
 *
 * @param props - 입력 레이블, 현재 문자열과 화면 내부 변경 함수입니다.
 * @returns 레이블과 테두리 입력란을 포함한 요소입니다.
 */
function AccountField({ label, value, onChangeText, placeholder, password = false, tall = false }: {
  /** 입력란 위와 접근성 이름에 사용하는 레이블입니다. */
  label: string;
  /** 화면에서 입력 중인 문자열입니다. */
  value: string;
  /** 화면 내부 문자열을 변경하는 함수입니다. */
  onChangeText: (value: string) => void;
  /** 입력 전 안내 문구입니다. */
  placeholder: string;
  /** 비밀번호 가림과 표시 전환 버튼을 제공할지 지정합니다. */
  password?: boolean;
  /** 로그인 시안의 58 높이 입력란을 사용할지 지정합니다. */
  tall?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[s.label, styles.fieldLabel]}>{label}</Text>
      <View style={[styles.inputFrame, tall && styles.tallInput]}>
        <Icon name={password ? 'lock' : 'mail'} size={22} color={colors.muted} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={password && !visible}
          autoCapitalize="none"
          autoCorrect={false}
          style={[s.text, styles.input]}
        />
        {password && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${visible ? '숨기기' : '표시'}`} onPress={() => setVisible(!visible)} style={styles.eyeButton}>
            <Icon name={visible ? 'eyeOff' : 'eye'} size={21} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * 계정 화면의 원형 아이콘, 설명과 이동 화살표를 한 행에 배치합니다.
 *
 * @param props - 표시 문구, 아이콘과 화면 이동 동작입니다.
 * @returns 시안의 설정 메뉴 행입니다.
 */
function AccountMenu({ title, subtitle, icon, onPress, disabled = false, warm = false }: {
  /** 메뉴 이름입니다. */
  title: string;
  /** 메뉴 아래의 보조 설명입니다. */
  subtitle: string;
  /** 원형 배경 안에 표시할 아이콘 이름입니다. */
  icon: string;
  /** 메뉴를 눌렀을 때 실행할 화면 이동입니다. */
  onPress?: () => void;
  /** 서버 연동이 필요한 메뉴의 비활성 상태입니다. */
  disabled?: boolean;
  /** 구매 메뉴에 갈색 배색을 사용할지 지정합니다. */
  warm?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.menu}>
      <View style={[styles.menuIcon, warm && styles.warmIcon]}><Icon name={icon} size={23} color={warm ? colors.brown : '#417E9E'} /></View>
      <View style={styles.menuText}>
        <Text style={[s.subtitle, styles.menuTitle]}>{title}</Text>
        <Text style={[s.muted, styles.menuSubtitle]}>{subtitle}</Text>
      </View>
      <Icon name="next" size={18} color={colors.muted} />
    </Pressable>
  );
}
// #endregion

// #region 로그인과 회원가입
/**
 * 중앙 브랜드, 아이콘 입력란과 외부 로그인 버튼을 시안의 순서로 표시합니다.
 *
 * @remarks
 * 입력과 비밀번호 표시 여부는 화면 내부 상태입니다. 인증과 비밀번호 복구는
 * 비활성화하며, 하단 가입하기만 회원가입 화면으로 이동합니다.
 *
 * @returns 로그인 시안의 입력·동작·하단 가입 영역입니다.
 */
export function LoginScreen() {
  const app = useApp();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.authPage, styles.loginPage]}>
      <View style={styles.loginBrand}>
        <Image source={require('../assets/brand/header.png')} style={styles.loginLogo} />
        <Text style={[s.title, styles.brandName]}>모북이</Text>
      </View>
      <AccountField label="이메일 또는 ID" value={identity} onChangeText={setIdentity} placeholder="이메일 또는 ID" tall />
      <View style={styles.loginPassword}><AccountField label="비밀번호" value={password} onChangeText={setPassword} placeholder="비밀번호" password tall /></View>
      <View style={styles.loginSubmit}><Action label="로그인" disabled style={styles.authButton} /></View>
      <View style={styles.orRow}><View style={styles.divider} /><Text style={[s.muted, styles.orText]}>또는</Text><View style={styles.divider} /></View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.socialButton, styles.googleButton]}>
        <Text style={[s.subtitle, styles.googleMark]}>G</Text><Text style={[s.text, styles.socialLabel]}>Google 계정으로 로그인</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.socialButton, styles.kakaoButton]}>
        <Icon name="comment" color="#1D2520" size={26} /><Text style={[s.text, styles.socialLabel, styles.kakaoLabel]}>카카오 계정으로 로그인</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.recovery}><Text style={[s.text, styles.smallText]}>비밀번호를 잊으셨나요?</Text></Pressable>
      <View style={[styles.authFooter, styles.loginFooter]}>
        <Text style={[s.text, styles.smallText]}>계정이 없으신가요?</Text>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'signup' })}><Text style={[s.text, styles.textLink]}>가입하기</Text></Pressable>
      </View>
    </ScrollView>
  );
}

/**
 * 계정 만들기 제목, 세 입력란, 필수 동의 선택과 하단 로그인 이동을 표시합니다.
 *
 * @remarks
 * 입력과 체크 상태만 화면 안에 보관합니다. 실제 약관 내용 조회·회원 생성·검증은
 * 수행하지 않으며 가입과 약관 내용 열기는 비활성화합니다.
 *
 * @returns 회원가입 시안의 입력과 선택 요소입니다.
 */
export function SignupScreen() {
  const app = useApp();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.authPage, styles.signupPage]}>
      <View style={styles.signupIntro}>
        <View style={styles.introText}><Text style={[s.title, styles.introTitle]}>모북이 계정 만들기</Text><Text style={[s.muted, styles.introDescription]}>로그인에 사용할 정보를 입력해 주세요.</Text></View>
        <Image source={require('../assets/brand/header.png')} style={styles.signupLogo} />
      </View>
      <AccountField label="이메일 또는 ID" value={identity} onChangeText={setIdentity} placeholder="이메일 또는 ID 입력" />
      <View style={styles.signupPassword}>
        <AccountField label="비밀번호" value={password} onChangeText={setPassword} placeholder="비밀번호 입력" password />
        <Text style={[s.muted, styles.fieldHint]}>영문·숫자를 포함해 8자 이상 입력해 주세요.</Text>
      </View>
      <View style={styles.signupConfirmation}><AccountField label="비밀번호 확인" value={confirmation} onChangeText={setConfirmation} placeholder="비밀번호를 한 번 더 입력" password /></View>
      <View style={styles.agreements}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: terms }} onPress={() => setTerms(!terms)} style={styles.agreementRow}>
          <View style={[styles.checkbox, terms && styles.checkboxChecked]}>{terms && <Icon name="check" color="#FFFFFF" size={16} />}</View>
          <Text style={[s.text, styles.agreementText]}>이용약관 동의 (필수)</Text><Icon name="next" color={colors.muted} size={16} />
        </Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: privacy }} onPress={() => setPrivacy(!privacy)} style={styles.agreementRow}>
          <View style={[styles.checkbox, privacy && styles.checkboxChecked]}>{privacy && <Icon name="check" color="#FFFFFF" size={16} />}</View>
          <Text style={[s.text, styles.agreementText]}>개인정보 수집·이용 동의 (필수)</Text><Icon name="next" color={colors.muted} size={16} />
        </Pressable>
      </View>
      <View style={styles.signupSubmit}><Action label="가입하기" disabled style={styles.authButton} /></View>
      <View style={styles.authFooter}><Text style={[s.text, styles.smallText]}>이미 계정이 있으신가요?</Text><Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'login' })}><Text style={[s.text, styles.textLink]}>로그인</Text></Pressable></View>
    </ScrollView>
  );
}
// #endregion

// #region 마이페이지와 계정 관리
/**
 * 회원 영역, 세 열의 개인 메뉴, 내 작품 카드와 설정 메뉴를 표시합니다.
 *
 * @remarks
 * 회원 이름·통계·작품은 {@link EmptyState}로 표시하고 숫자를 가정하지 않습니다.
 * 내 작품 영역에는 고정된 표지 자리나 작품 개수를 만들지 않습니다.
 * 서재·독서 기록·읽기 설정의 화면 이동만 제공하며 관리와 구매는 비활성화합니다.
 *
 * @returns 마이 시안의 회원·통계·작품·메뉴 영역입니다.
 */
export function MyScreen() {
  const app = useApp();
  return (
    <View style={styles.myPage}>
      <View style={styles.profileRow}>
        <View style={styles.avatar}><Image source={require('../assets/brand/header.png')} style={styles.avatarLogo} /></View>
        <View style={styles.profileText}><EmptyState compact title="회원 정보가 없습니다." style={styles.profileEmpty} /></View>
      </View>
      <View style={styles.stats}>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'library' })} style={styles.stat}><EmptyState compact title="—" style={styles.statEmpty} /><Text style={[s.text, styles.statLabel]}>내 서재</Text></Pressable>
        <View style={styles.statDivider} />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.stat}><EmptyState compact title="—" style={styles.statEmpty} /><Text style={[s.text, styles.statLabel]}>즐겨찾기</Text></Pressable>
        <View style={styles.statDivider} />
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'records' })} style={styles.stat}><EmptyState compact title="—" style={styles.statEmpty} /><Text style={[s.text, styles.statLabel]}>독서 기록</Text></Pressable>
      </View>
      <View style={styles.ownedHeading}><Text style={[s.subtitle, styles.sectionTitle]}>내 작품</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.manage}><Text style={[s.text, styles.manageText]}>관리하기</Text></Pressable></View>
      <View style={styles.ownedCard}><EmptyState compact title="표시할 내 작품이 없습니다." style={styles.ownedInfo} /></View>
      <View style={styles.myMenus}>
        <AccountMenu title="읽기 설정" subtitle="글꼴 · 글자 크기 · 배경 · 읽기 효과" icon="book" onPress={() => app.navigate({ screen: 'readingSettings' })} />
        <View style={styles.menuDivider} />
        <AccountMenu title="구매 내역" subtitle="구매한 작품과 결제 내역" icon="receipt" warm disabled />
      </View>
    </View>
  );
}

/**
 * 회원 카드, 계정 정보 표와 비밀번호·탈퇴·로그아웃 메뉴를 표시합니다.
 *
 * @remarks
 * 이름·아이디·이메일·가입일 값은 빈 요소로 유지합니다. 비밀번호와 탈퇴 패널은
 * 화면 이동만 수행하며 인증 상태를 바꾸지 않습니다.
 *
 * @returns 계정 설정 시안의 카드·정보 행·하단 동작입니다.
 */
export function AccountScreen() {
  const app = useApp();
  return (
    <View style={styles.accountPage}>
      <View style={styles.accountCard}>
        <View style={styles.profileRow}><View style={[styles.avatar, styles.accountAvatar]}><Image source={require('../assets/brand/header.png')} style={styles.avatarLogo} /></View><View style={styles.profileText}><EmptyState compact title="회원 정보가 없습니다." style={styles.profileEmpty} /></View></View>
        <View style={styles.accountDivider} />
        <View style={styles.accountIdRow}><Text style={[s.muted, styles.accountIdLabel]}>아이디</Text><EmptyState compact title="—" style={styles.valueEmpty} /></View>
      </View>
      <Text style={[s.subtitle, styles.accountSection]}>계정 정보</Text>
      <View style={styles.infoRow}><Text style={[s.text, styles.infoLabel]}>이메일</Text><EmptyState compact title="—" style={styles.valueEmpty} /></View>
      <View style={styles.infoRow}><Text style={[s.text, styles.infoLabel]}>가입일</Text><EmptyState compact title="—" style={styles.valueEmpty} /></View>
      <View style={styles.passwordMenu}><AccountMenu title="비밀번호 변경" subtitle="새 비밀번호로 변경합니다." icon="lock" onPress={() => app.navigate({ screen: 'password' })} /><View style={styles.menuDivider} /></View>
      <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'withdraw' })} style={styles.withdrawLink}><Text style={[s.text, styles.withdrawLabel]}>회원 탈퇴</Text><Icon name="next" size={18} color={colors.brown} /></Pressable>
      <View style={styles.logoutArea}><Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.logout}><Text style={[s.text, styles.logoutText]}>로그아웃</Text><Icon name="logout" size={22} /></Pressable></View>
    </View>
  );
}

/**
 * 새 비밀번호 안내, 세 개의 가림 입력과 하단 변경 버튼을 표시합니다.
 *
 * @remarks
 * 비밀번호 문자열과 표시 여부는 화면 내부에만 유지합니다. 안내 문구를 표시하되
 * 기존 비밀번호 확인·정책 검증·서버 변경은 수행하지 않습니다.
 *
 * @returns 비밀번호 변경 시안의 입력과 고정 하단 동작 영역입니다.
 */
export function PasswordScreen() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.authPage, styles.passwordPage]}>
      <Text style={[s.title, styles.introTitle]}>새 비밀번호 설정</Text>
      <Text style={[s.muted, styles.passwordIntro]}>계정을 보호할 비밀번호를 입력해 주세요.</Text>
      <AccountField label="현재 비밀번호" value={current} onChangeText={setCurrent} placeholder="현재 비밀번호 입력" password />
      <View style={styles.passwordGap}><AccountField label="새 비밀번호" value={password} onChangeText={setPassword} placeholder="영문·숫자 포함 8자 이상" password /></View>
      <View style={styles.passwordGap}><AccountField label="새 비밀번호 확인" value={confirmation} onChangeText={setConfirmation} placeholder="새 비밀번호 다시 입력" password /></View>
      <Text style={[s.muted, styles.passwordHint]}>다른 곳에서 사용하지 않는 비밀번호를 권장합니다.</Text>
      <View style={styles.passwordSubmit}><Action label="비밀번호 변경" disabled style={styles.authButton} /></View>
    </ScrollView>
  );
}

/**
 * 경고 아이콘, 탈퇴 안내와 계속 이용하기·탈퇴하기 동작을 표시합니다.
 *
 * @remarks
 * 계속 이용하기는 열린 패널을 닫습니다. 탈퇴 실행은 비활성화되어 있으며
 * 회원 확인·인증 변경·데이터 삭제는 수행하지 않습니다.
 *
 * @returns 탈퇴 확인 시안의 하단 패널 내용입니다.
 */
export function WithdrawScreen() {
  const app = useApp();
  return (
    <View style={styles.withdrawPage}>
      <View style={styles.warning}><Icon name="warning" size={24} color={colors.brown} /></View>
      <Text style={[s.title, styles.withdrawTitle]}>모북이를 탈퇴하시겠습니까?</Text>
      <Text style={[s.text, styles.withdrawDescription]}>계정과 저장한 독서 기록이 삭제됩니다.{'\n'}탈퇴 후에는 복구할 수 없습니다.</Text>
      <Text style={[s.muted, styles.withdrawHint]}>계속 읽고 싶은 작품이 있다면 한 번 더 확인해 주세요.</Text>
      <Action label="계속 이용하기" onPress={app.back} style={styles.authButton} />
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.withdrawAction}><Text style={[s.text, styles.withdrawLabel]}>탈퇴하기</Text></Pressable>
    </View>
  );
}
// #endregion

// #region 읽기 설정
/**
 * 테마 미리보기, 글꼴 타일, 글자 크기와 읽기 효과 선택을 표시합니다.
 *
 * @remarks
 * 각 선택값은 패널의 임시 UI 상태입니다. 회원 설정 객체나 서버 응답을 만들지 않으며,
 * 적용 버튼은 비활성화되어 본문 설정 변경·저장을 수행하지 않습니다.
 *
 * @returns 읽기 설정 시안의 미리보기와 선택 도구입니다.
 */
export function ReadingSettingsScreen() {
  const [theme, setTheme] = useState('크림');
  const [font, setFont] = useState('기본 명조');
  const [size, setSize] = useState(2);
  const [mode, setMode] = useState('스크롤');
  const [animation, setAnimation] = useState(true);
  const [sound, setSound] = useState(true);
  return (
    <View style={styles.settingsPage}>
      <Text style={[s.title, styles.settingsTitle]}>읽기 설정</Text>
      <Text style={[s.label, styles.settingsLabel]}>화면 테마</Text>
      <View style={styles.themeRow}>
        {([['크림', '#F7F1E4'], ['연노랑', '#FFF3C7'], ['연회색', '#ECEEF1'], ['다크', '#233B2F']] as const).map(([label, background]) => (
          <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: theme === label }} accessibilityLabel={label + ' 테마'} onPress={() => setTheme(label)} style={styles.themeItem}>
            <View style={[styles.themePreview, { backgroundColor: background }, theme === label && styles.selectedBorder]}><Text style={[s.text, styles.previewLetter, label === '다크' && styles.lightText]}>가</Text>{theme === label && <View style={styles.themeCheck}><Icon name="check" size={11} color="#FFFFFF" /></View>}</View>
            <Text style={[s.muted, styles.themeLabel, theme === label && styles.selectedText]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.label, styles.settingsLabel]}>글꼴</Text>
      <View style={styles.fontGrid}>
        {['기본 명조', '기본 고딕', '나눔명조', '나눔고딕', '고운바탕', '고운돋움', '함렛', '플렉스고딕'].map(label => (
          <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: font === label }} onPress={() => setFont(label)} style={[styles.fontTile, font === label && styles.selectedBorder]}>
            <Text style={[s.text, styles.fontPreview, font === label && styles.selectedText]}>가</Text><Text numberOfLines={1} style={[s.text, styles.fontLabel, font === label && styles.selectedText]}>{label}</Text>{font === label && <Icon name="check" size={14} color={colors.green} />}
          </Pressable>
        ))}
      </View>
      <Text style={[s.label, styles.settingsLabel]}>글자 크기</Text>
      <View style={styles.sizeRow}>{[13, 15, 17, 19, 21].map((fontSize, index) => <Pressable key={fontSize} accessibilityRole="radio" accessibilityLabel={`글자 크기 ${index + 1}단계`} accessibilityState={{ checked: size === index }} onPress={() => setSize(index)} style={[styles.sizeOption, size === index && styles.sizeSelected]}><Text style={[s.text, { fontSize }, size === index && styles.selectedText]}>가</Text></Pressable>)}</View>
      <View style={styles.settingRow}><Text numberOfLines={1} style={[s.text, styles.settingName]}>읽기 방식</Text><View style={styles.modeRow}>{['스크롤', '책장'].map(label => <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: mode === label }} onPress={() => setMode(label)} style={[styles.modeOption, mode === label && styles.modeSelected]}><Text numberOfLines={1} style={[s.text, styles.modeLabel, mode === label && styles.lightText]}>{label}</Text></Pressable>)}</View></View>
      <View style={styles.settingRow}><Text numberOfLines={1} style={[s.text, styles.settingName]}>페이지 전환 애니메이션</Text><Switch accessibilityLabel="페이지 전환 애니메이션" value={animation} onValueChange={setAnimation} trackColor={{ false: '#E3E8DC', true: colors.green }} thumbColor="#FFFFFF" /></View>
      <View style={styles.settingRow}><Text numberOfLines={1} style={[s.text, styles.settingName]}>페이지 전환 효과음</Text><Switch accessibilityLabel="페이지 전환 효과음" value={sound} onValueChange={setSound} trackColor={{ false: '#E3E8DC', true: colors.green }} thumbColor="#FFFFFF" /></View>
      <Action label="적용" disabled style={styles.applyButton} />
    </View>
  );
}
// #endregion

// #region 계정과 읽기 설정 스타일
/** 계정 입력·메뉴·미리보기의 시안 배치와 색상을 정의합니다. */
const styles = StyleSheet.create({
  authPage: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 16, backgroundColor: '#FFFFFF' },
  loginPage: { minHeight: 712 },
  loginBrand: { height: 112, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  loginLogo: { width: 68, height: 78, resizeMode: 'contain' },
  brandName: { fontSize: 31, lineHeight: 44, fontWeight: '700' },
  field: { gap: 12 },
  fieldLabel: { fontSize: 12, lineHeight: 19, color: '#625D50', fontWeight: '700' },
  inputFrame: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E8DC', borderRadius: 14, paddingLeft: 17, paddingRight: 12, gap: 13 },
  tallInput: { minHeight: 58, borderWidth: 2, borderRadius: 18 },
  input: { flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 14 },
  eyeButton: { minWidth: 32, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  loginPassword: { marginTop: 12 },
  loginSubmit: { marginTop: 16 },
  authButton: { minHeight: 52, borderRadius: 27 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginVertical: 23 },
  divider: { flex: 1, height: 1, backgroundColor: '#E3E8DC' },
  orText: { fontSize: 12 },
  socialButton: { minHeight: 54, borderRadius: 27, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 12 },
  googleButton: { borderWidth: 2, borderColor: '#E3E8DC', backgroundColor: '#FFFFFF' },
  googleMark: { width: 28, fontSize: 24, fontWeight: '700', color: '#4285F4' },
  socialLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', marginRight: 25 },
  kakaoButton: { backgroundColor: '#FEE500' },
  kakaoLabel: { color: '#1D2520' },
  recovery: { minHeight: 58, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 12, color: '#625D50' },
  authFooter: { minHeight: 50, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  loginFooter: { marginTop: 'auto', paddingTop: 16, borderTopWidth: 1, borderColor: '#E3E8DC' },
  textLink: { color: colors.green, fontSize: 13, fontWeight: '700' },
  signupPage: { paddingTop: 30, minHeight: 712 },
  signupIntro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 34 },
  introText: { flex: 1 },
  introTitle: { fontSize: 24, lineHeight: 34, fontWeight: '700' },
  introDescription: { fontSize: 12, marginTop: 9 },
  signupLogo: { width: 54, height: 60, resizeMode: 'contain' },
  signupPassword: { marginTop: 20 },
  fieldHint: { fontSize: 11, marginTop: 8 },
  signupConfirmation: { marginTop: 22 },
  agreements: { marginTop: 22, gap: 4 },
  agreementRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 12 },
  agreementText: { fontSize: 13, flex: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.green },
  signupSubmit: { marginTop: 'auto', paddingTop: 32 },
  myPage: { padding: 20, paddingTop: 16, paddingBottom: 24, backgroundColor: '#FFFFFF' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#EEE3D3', alignItems: 'center', justifyContent: 'center' },
  avatarLogo: { width: 44, height: 48, resizeMode: 'contain' },
  profileText: { flex: 1, minWidth: 0 },
  profileEmpty: { padding: 0, minHeight: 58, alignItems: 'flex-start' },
  stats: { flexDirection: 'row', alignItems: 'center', minHeight: 101, borderRadius: 22, backgroundColor: '#F2F6ED', marginTop: 28 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  statEmpty: { minHeight: 44, padding: 0 },
  statLabel: { fontSize: 12, color: '#625D50' },
  statDivider: { width: 1, height: 48, backgroundColor: '#E3E8DC' },
  ownedHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, marginBottom: 12 },
  sectionTitle: { fontSize: 20 },
  manage: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F2F6ED' },
  manageText: { color: colors.green, fontSize: 12, fontWeight: '700' },
  ownedCard: { borderRadius: 20, backgroundColor: '#F2F6ED', padding: 16 },
  ownedInfo: { padding: 0 },
  myMenus: { marginTop: 24 },
  menu: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 16 },
  menuIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F2F6ED', alignItems: 'center', justifyContent: 'center' },
  warmIcon: { backgroundColor: '#EEE3D3' },
  menuText: { flex: 1, gap: 5 },
  menuTitle: { fontSize: 17, fontWeight: '700' },
  menuSubtitle: { fontSize: 11 },
  menuDivider: { height: 1, backgroundColor: '#E3E8DC', marginLeft: 60 },
  accountPage: { flexGrow: 1, padding: 20, paddingTop: 24, minHeight: 712, backgroundColor: '#FFFFFF' },
  accountCard: { minHeight: 164, borderRadius: 22, backgroundColor: '#F2F6ED', padding: 20 },
  accountAvatar: { width: 52, height: 52, borderRadius: 26 },
  accountDivider: { height: 1, backgroundColor: '#E3E8DC', marginTop: 18, marginBottom: 10 },
  accountIdRow: { flexDirection: 'row', alignItems: 'center' },
  accountIdLabel: { width: 92, fontSize: 12 },
  valueEmpty: { minHeight: 28, padding: 0, flexDirection: 'row', gap: 6 },
  accountSection: { fontSize: 18, marginTop: 38, marginBottom: 14 },
  infoRow: { minHeight: 58, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: '#E3E8DC' },
  infoLabel: { fontSize: 13, color: '#625D50' },
  passwordMenu: { marginTop: 24 },
  withdrawLink: { minHeight: 76, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  withdrawLabel: { color: colors.brown, fontSize: 13, fontWeight: '600' },
  logoutArea: { marginTop: 'auto', paddingTop: 32 },
  logout: { minHeight: 52, borderRadius: 26, backgroundColor: '#F2F6ED', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  logoutText: { fontSize: 14, fontWeight: '700' },
  passwordPage: { minHeight: 712, paddingTop: 36, paddingBottom: 28 },
  passwordIntro: { marginTop: 12, marginBottom: 44, fontSize: 13 },
  passwordGap: { marginTop: 32 },
  passwordHint: { marginTop: 18, fontSize: 11 },
  passwordSubmit: { marginTop: 'auto', paddingTop: 42 },
  withdrawPage: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 16 },
  warning: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEE3D3', alignItems: 'center', justifyContent: 'center' },
  withdrawTitle: { marginTop: 26, fontSize: 23, lineHeight: 32 },
  withdrawDescription: { marginTop: 20, fontSize: 14, lineHeight: 22, color: '#625D50' },
  withdrawHint: { marginTop: 32, marginBottom: 50, fontSize: 11 },
  withdrawAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  settingsPage: { paddingHorizontal: 24, paddingBottom: 4, gap: 10 },
  settingsTitle: { fontSize: 22, lineHeight: 30, marginBottom: 4 },
  settingsLabel: { fontSize: 12, color: '#625D50' },
  themeRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  themeItem: { flex: 1, alignItems: 'center', gap: 7 },
  themePreview: { width: '100%', height: 48, borderRadius: 17, borderWidth: 2, borderColor: '#E3E8DC', alignItems: 'center', justifyContent: 'center' },
  previewLetter: { fontSize: 22, lineHeight: 34 },
  themeCheck: { position: 'absolute', right: -1, top: -1, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  themeLabel: { fontSize: 10 },
  selectedBorder: { borderColor: colors.green },
  selectedText: { color: colors.green, fontWeight: '600' },
  lightText: { color: '#FFFFFF' },
  fontGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fontTile: { width: '48%', minWidth: 130, flexGrow: 1, height: 42, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 16, borderWidth: 2, borderColor: '#E3E8DC', backgroundColor: '#F2F6ED' },
  fontPreview: { fontSize: 20, lineHeight: 30, color: '#625D50' },
  fontLabel: { flex: 1, fontSize: 13, color: '#625D50' },
  sizeRow: { flexDirection: 'row', backgroundColor: '#F2F6ED', borderRadius: 24, minHeight: 44, padding: 4, marginBottom: 4 },
  sizeOption: { flex: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sizeSelected: { backgroundColor: '#FFFFFF' },
  settingRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  settingName: { fontSize: 12, flexShrink: 1 },
  modeRow: { width: '64%', maxWidth: 204, flexShrink: 0, flexDirection: 'row', backgroundColor: '#F2F6ED', borderRadius: 24, padding: 4, minHeight: 44 },
  modeOption: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  modeSelected: { backgroundColor: colors.green },
  modeLabel: { fontSize: 12 },
  applyButton: { minHeight: 42, borderRadius: 24, marginTop: 2 },
});
// #endregion

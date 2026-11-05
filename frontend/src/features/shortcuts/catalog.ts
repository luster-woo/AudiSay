/**
 * AudiSay 단축키 목록 (원본).
 * 도움말 '단축키' 탭이 이 목록을 그대로 보여 준다. 단축키 안내 창(Alt+Shift+/)과
 * 실제 키 등록(useShortcut)도 이 목록을 읽도록 옮길 예정이다.
 * 모든 키는 Alt+Shift 와 함께 누른다 (낭독기의 한 글자 이동 키와 겹치지 않게, 원칙 5장).
 */
export type ShortcutGroupId = 'everywhere' | 'watch'

export interface ShortcutEntry {
  id: string
  group: ShortcutGroupId
  /** Alt+Shift 다음에 누르는 키. 여러 개면 그중 하나를 누른다 */
  keys: string[]
  /** 화면에 보이는 동작 이름 */
  description: string
  /** 기억을 돕는 짧은 말 */
  hint: string
  /** 낭독용 키 이름. 예: '에이치', '제이 또는 엘' */
  spokenKeys: string
  /** 동작 이름에 기호가 있을 때 낭독용 문장 */
  spokenDescription?: string
}

export const SHORTCUT_MODIFIER = 'Alt+Shift'
const SPOKEN_MODIFIER = '알트와 시프트를 누른 상태에서'

export const shortcutGroups: { id: ShortcutGroupId; label: string; note: string }[] = [
  { id: 'everywhere', label: '어디서나', note: '모든 화면에서 쓸 수 있어요.' },
  { id: 'watch', label: '영상 볼 때', note: '영상을 보는 화면에서 쓸 수 있어요.' },
]

export const shortcutCatalog: ShortcutEntry[] = [
  {
    id: 'home',
    group: 'everywhere',
    keys: ['H'],
    description: '홈으로 가기',
    hint: 'Home의 H',
    spokenKeys: '에이치',
  },
  {
    id: 'repeat',
    group: 'everywhere',
    keys: ['R'],
    description: '방금 안내 다시 듣기',
    hint: 'Repeat의 R',
    spokenKeys: '알',
  },
  {
    id: 'help',
    group: 'everywhere',
    keys: ['/'],
    description: '지금 화면의 단축키 보기',
    hint: '물음표와 같은 키예요',
    spokenKeys: '슬래시',
  },
  {
    id: 'play',
    group: 'watch',
    keys: ['K'],
    description: '재생 / 일시정지',
    hint: '유튜브와 같은 키예요',
    spokenKeys: '케이',
    spokenDescription: '재생하거나 일시정지해요.',
  },
  {
    id: 'seek',
    group: 'watch',
    keys: ['J', 'L'],
    description: '뒤로 / 앞으로 이동',
    hint: '왼쪽 J는 뒤로, 오른쪽 L은 앞으로',
    spokenKeys: '제이 또는 엘',
    spokenDescription: '제이 키는 뒤로, 엘 키는 앞으로 이동해요. 간격은 재생 설정에서 바꿔요.',
  },
  {
    id: 'position',
    group: 'watch',
    keys: ['P'],
    description: '지금 재생 위치 듣기',
    hint: 'Position의 P',
    spokenKeys: '피',
  },
  {
    id: 'describe',
    group: 'watch',
    keys: ['D'],
    description: '지금 장면 설명 듣기',
    hint: 'Describe의 D',
    spokenKeys: '디',
  },
  {
    id: 'detail',
    group: 'watch',
    keys: ['1', '2', '3'],
    description: '해설 짧게 / 기본 / 자세히',
    hint: '숫자가 클수록 자세히',
    spokenKeys: '숫자 일 또는 이 또는 삼',
    spokenDescription: '해설을 일은 짧게, 이는 기본, 삼은 자세히 들려줘요.',
  },
  {
    id: 'ask',
    group: 'watch',
    keys: ['Q'],
    description: '질문하기',
    hint: 'Question의 Q. 말 대신 글자로 적어도 돼요',
    spokenKeys: '큐',
  },
  {
    id: 'settings',
    group: 'watch',
    keys: ['S'],
    description: '재생 설정 열기',
    hint: 'Settings의 S',
    spokenKeys: '에스',
  },
  {
    id: 'report',
    group: 'watch',
    keys: ['X'],
    description: '지금 해설 문장 신고',
    hint: '틀린 해설에 X 표시',
    spokenKeys: '엑스',
  },
]

/** 'Alt+Shift+K' 형태 (useShortcut 등록용) */
export function comboOf(key: string) {
  return `${SHORTCUT_MODIFIER}+${key}`
}

/** '알트와 시프트를 누른 상태에서 케이 키를 누르세요.' */
export function spokenCommandOf(entry: ShortcutEntry) {
  return `${SPOKEN_MODIFIER} ${entry.spokenKeys} 키를 누르세요.`
}

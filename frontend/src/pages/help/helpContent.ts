export interface HelpRow {
  command: string
  description: string
  spokenCommand: string
  spokenDescription?: string
}

export type ShortcutCategory = 'everywhere' | 'playback' | 'questions'
export type VoiceCategory = 'playback' | 'scenes' | 'questions' | 'home'

// 사용자와 확정한 와이어프레임 문구. 플레이어 담당자가 키·음성 동작을 추가할 예정이므로
// 현재 등록된 키 목록과 분리한다. 도움말 구현에서 플레이어의 동작을 변경하지 않는다.
export const shortcutCategories: { value: ShortcutCategory; label: string; rows: HelpRow[] }[] = [
  {
    value: 'everywhere',
    label: '어디서나',
    rows: [
      {
        command: 'Alt+Shift+H',
        description: '홈으로 이동',
        spokenCommand: '알트와 시프트를 누른 상태에서 에이치 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+R',
        description: '방금 안내 다시 듣기',
        spokenCommand: '알트와 시프트를 누른 상태에서 알 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+/',
        description: '현재 화면의 단축키 듣기',
        spokenCommand: '알트와 시프트를 누른 상태에서 슬래시 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+U',
        description: '영상 등록',
        spokenCommand: '알트와 시프트를 누른 상태에서 유 키를 누르세요.',
      },
    ],
  },
  {
    value: 'playback',
    label: '재생과 이동',
    rows: [
      {
        command: 'Alt+Shift+K',
        description: '재생 / 일시정지',
        spokenCommand: '알트와 시프트를 누른 상태에서 케이 키를 누르세요.',
        spokenDescription: '영상을 재생하거나 일시정지해요.',
      },
      {
        command: 'Alt+Shift+J / L',
        description: '앞뒤로 이동',
        spokenCommand: '알트와 시프트를 누른 상태에서 제이 또는 엘 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+P',
        description: '현재 재생 위치 듣기',
        spokenCommand: '알트와 시프트를 누른 상태에서 피 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+D',
        description: '현재 장면 설명',
        spokenCommand: '알트와 시프트를 누른 상태에서 디 키를 누르세요.',
      },
    ],
  },
  {
    value: 'questions',
    label: '질문과 설정',
    rows: [
      {
        command: 'Alt+Shift+1~3',
        description: '해설 상세도 조절',
        spokenCommand: '알트와 시프트를 누른 상태에서 숫자 일 또는 이 또는 삼 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+Q / V',
        description: '글자 질문 / 말로 질문',
        spokenCommand: '알트와 시프트를 누른 상태에서 큐 또는 브이 키를 누르세요.',
        spokenDescription: '큐 키는 글자로 질문하기예요. 브이 키는 말로 질문하기예요.',
      },
      {
        command: 'Alt+Shift+C / N / G',
        description: '목차 / 대본 / 질문',
        spokenCommand: '알트와 시프트를 누른 상태에서 씨 또는 엔 또는 지 키를 누르세요.',
        spokenDescription: '씨 키는 목차예요. 엔 키는 대본이에요. 지 키는 질문이에요.',
      },
      {
        command: 'Alt+Shift+S',
        description: '재생 설정 열기',
        spokenCommand: '알트와 시프트를 누른 상태에서 에스 키를 누르세요.',
      },
      {
        command: 'Alt+Shift+F / X',
        description: '즐겨찾기 / 신고',
        spokenCommand: '알트와 시프트를 누른 상태에서 에프 또는 엑스 키를 누르세요.',
        spokenDescription: '에프 키는 즐겨찾기예요. 엑스 키는 신고예요.',
      },
    ],
  },
]

export const voiceCategories: { value: VoiceCategory; label: string; rows: HelpRow[] }[] = [
  {
    value: 'playback',
    label: '재생 조절',
    rows: [
      {
        command: '‘멈춰’ / ‘다시 틀어’',
        description: '일시정지 / 재생',
        spokenCommand: '멈춰 또는 다시 틀어라고 말하세요.',
        spokenDescription: '멈춰는 일시정지예요. 다시 틀어는 재생이에요.',
      },
      {
        command: '‘10초 뒤로’',
        description: '말한 시간만큼 앞뒤로 이동',
        spokenCommand: '십 초 뒤로라고 말하세요.',
      },
      {
        command: '‘2분 30초로’',
        description: '지정한 시각으로 이동',
        spokenCommand: '이 분 삼십 초로라고 말하세요.',
      },
      {
        command: '‘조금 느리게’ / ‘보통으로’',
        description: '0.75배속 / 기본 속도',
        spokenCommand: '조금 느리게 또는 보통으로라고 말하세요.',
        spokenDescription: '조금 느리게는 영 점 칠오 배속이에요. 보통으로는 기본 속도예요.',
      },
    ],
  },
  {
    value: 'scenes',
    label: '장면 찾기',
    rows: [
      {
        command: '‘다음 장면’',
        description: '다음 장면으로 이동',
        spokenCommand: '다음 장면이라고 말하세요.',
      },
      {
        command: '‘그래프 나오는 장면으로’',
        description: '말한 장면을 찾아 이동',
        spokenCommand: '그래프 나오는 장면으로라고 말하세요.',
      },
      {
        command: '‘지금 화면에 뭐 있어?’',
        description: '영상을 멈추고 장면 설명',
        spokenCommand: '지금 화면에 뭐 있어라고 물어보세요.',
      },
      {
        command: '‘방금 자막 뭐래?’',
        description: '화면의 글자 읽기',
        spokenCommand: '방금 자막 뭐래라고 물어보세요.',
      },
    ],
  },
  {
    value: 'questions',
    label: '질문과 해설',
    rows: [
      {
        command: '‘이 사람 누구야?’',
        description: '화면 속 인물·사물 설명',
        spokenCommand: '이 사람 누구야라고 물어보세요.',
        spokenDescription: '화면 속 인물이나 사물을 설명해요.',
      },
      {
        command: '‘지금 몇 분이야?’',
        description: '현재 재생 위치와 남은 시간',
        spokenCommand: '지금 몇 분이야라고 물어보세요.',
      },
      {
        command: '‘더 자세히’ / ‘짧게’',
        description: '해설 상세도 한 단계 조절',
        spokenCommand: '더 자세히 또는 짧게라고 말하세요.',
      },
      {
        command: '‘여기 신고’',
        description: '현재 해설 문장 신고',
        spokenCommand: '여기 신고라고 말하세요.',
      },
    ],
  },
  {
    // 홈 음성 검색: 받아쓴 말을 챗봇이 먼저 나눈다 (글자 검색은 그대로 검색)
    value: 'home',
    label: '홈 음성 검색',
    rows: [
      {
        command: '‘고양이 영상 찾아 줘’',
        description: '말한 영상 검색',
        spokenCommand: '고양이 영상 찾아 줘라고 말하세요.',
      },
      {
        command: '‘말 빠르게’ / ‘고대비 켜 줘’',
        description: '설정 바꾸기',
        spokenCommand: '말 빠르게 또는 고대비 켜 줘라고 말하세요.',
        spokenDescription: '검색하지 않고 설정을 바꿔요.',
      },
      {
        command: '‘도움말’',
        description: '도움말 열기',
        spokenCommand: '도움말이라고 말하세요.',
      },
      {
        command: '‘사용법 다시’',
        description: '사용법 처음부터',
        spokenCommand: '사용법 다시라고 말하세요.',
      },
    ],
  },
]

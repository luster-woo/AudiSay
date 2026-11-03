export interface HelpRow {
  command: string
  description: string
}

export type ShortcutCategory = 'everywhere' | 'playback' | 'questions'
export type VoiceCategory = 'playback' | 'scenes' | 'questions'

export const shortcutCategories: { value: ShortcutCategory; label: string; rows: HelpRow[] }[] = [
  { value: 'everywhere', label: '어디서나', rows: [] },
  {
    value: 'playback',
    label: '재생과 이동',
    rows: [
      { command: 'Space', description: '재생 버튼이나 영상 영역에서 재생·일시정지' },
      { command: '← / →', description: '재생 위치 슬라이더에서 설정한 간격만큼 이동' },
      { command: 'PageDown / PageUp', description: '재생 위치 슬라이더에서 1분 전·후로 이동' },
      { command: 'Home / End', description: '재생 위치 슬라이더에서 처음·끝으로 이동' },
    ],
  },
  {
    value: 'questions',
    label: '질문과 설정',
    rows: [
      { command: 'Alt+Shift+Q', description: '영상에서 말로 질문하기. 글자로도 입력할 수 있어요.' },
      { command: 'Alt+Shift+D', description: '영상의 지금 장면 설명 듣기' },
      { command: 'Alt+Shift+S', description: '영상의 30초 요약 다시 듣기' },
      {
        command: '1 / 2 / 3',
        description: '영상 영역에서 해설 상세도 선택. 입력칸에서는 적용되지 않아요.',
      },
    ],
  },
]

export const voiceCategories: { value: VoiceCategory; label: string; rows: HelpRow[] }[] = [
  {
    value: 'playback',
    label: '재생 조절',
    rows: [
      { command: '“멈춰” / “재생”', description: '일시정지 / 재생' },
      { command: '“30초 전으로 돌아가 줘”', description: '현재 위치에서 30초 전으로 이동' },
      { command: '“2분 30초로 가 줘”', description: '2분 30초 위치로 이동' },
      { command: '“말 좀 천천히 해 줄래”', description: '해설을 읽는 속도를 한 단계 낮춤' },
    ],
  },
  {
    value: 'scenes',
    label: '장면 찾기',
    rows: [
      { command: '“다음 장면으로 넘어가”', description: '다음 장면으로 이동' },
      { command: '“골 넣는 장면으로 가 줘”', description: '말한 내용과 관련된 장면을 찾아 이동' },
      { command: '“이 장면 설명해 줘”', description: '지금 장면의 설명 듣기' },
      {
        command: '“화면 글자 자세히 읽어 줘”',
        description: '현재 장면에 준비된 긴 글 읽기. 글이 없으면 안내해요.',
      },
    ],
  },
  {
    value: 'questions',
    label: '질문과 해설',
    rows: [
      { command: '“그 사람 누군지 자세히 말해 줘”', description: '영상 속 인물에 대해 질문' },
      { command: '“지금 몇 분쯤 왔어”', description: '현재 재생 위치와 장면 확인' },
      { command: '“설명을 더 자세하게 해 줘”', description: '해설 상세도를 한 단계 높임' },
      { command: '“요약 들려줘”', description: '영상의 요약 다시 듣기' },
    ],
  },
]

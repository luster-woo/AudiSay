import askImg from '@/assets/tour/ask.webp'
import clapImg from '@/assets/tour/clap.webp'
import playImg from '@/assets/tour/play.webp'
import pointImg from '@/assets/tour/point.webp'
import smileImg from '@/assets/tour/smile.webp'
import waveImg from '@/assets/tour/wave.webp'
import helpShot from '@/assets/tutorial/help.webp'
import homeShot from '@/assets/tutorial/home.webp'
import jobShot from '@/assets/tutorial/job.webp'
import myInfoShot from '@/assets/tutorial/my-info.webp'
import myVideosShot from '@/assets/tutorial/my-videos.webp'
import registerShot from '@/assets/tutorial/register.webp'
import watchShot from '@/assets/tutorial/watch.webp'
import youtubeShot from '@/assets/tutorial/youtube.webp'

/**
 * 예시 화면 = 실제 화면 캡처(1440×1000, 예시 데이터). 강조 영역은 캡처할 때 실제 요소에서 잰 위치(같은 1440×1000 좌표).
 * 강조 영역은 내용 덩어리 단위로 잡아 테두리가 글자나 버튼을 가로지르지 않게 한다 (홈 목록은 다 보이는 줄까지만).
 * 화면을 바꾸면 assets/tutorial 캡처와 아래 좌표를 함께 다시 만든다
 */
export const SHOT_WIDTH = 1440
export const SHOT_HEIGHT = 1000

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface TutorialScreen {
  name: string
  image: string
}

const SCREENS = {
  home: { name: '홈', image: homeShot },
  register: { name: '영상 등록', image: registerShot },
  youtube: { name: '유튜브 영상 확인', image: youtubeShot },
  job: { name: '해설 만들기', image: jobShot },
  watch: { name: '영상 보기', image: watchShot },
  myVideos: { name: '내 영상', image: myVideosShot },
  myInfo: { name: '내 정보', image: myInfoShot },
  help: { name: '도움말', image: helpShot },
} satisfies Record<string, TutorialScreen>

export interface TutorialStepData {
  screen: TutorialScreen
  /** 강조할 영역. 같은 화면이 이어지면 강조만 옮겨 간다 */
  target: Rect
  title: string
  body: string
  /** 사용 방법·키보드. 화면에는 작게, 낭독기는 설명 뒤에 이어 읽는다 */
  keys: string
  /** assets/tour 마스코트. 모두 320×400 캔버스에 강아지 키를 맞춰 둬서 단계마다 크기·위치가 같다 */
  mascot: string
}

export const TUTORIAL_STEPS: TutorialStepData[] = [
  {
    screen: SCREENS.home,
    target: { x: 64, y: 212, w: 880, h: 140 },
    title: '영상 불러오기',
    body: '유튜브 링크를 입력하거나 영상을 직접 업로드해 보세요. AI가 영상 내용을 분석해 드립니다.',
    keys: '검색 칸에 유튜브 주소나 영상 제목을 적고 검색을 눌러요. Alt+Shift+Q를 누르면 말로 찾을 수 있어요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.home,
    target: { x: 64, y: 402, w: 1297, h: 482 },
    title: '해설이 준비된 영상',
    body: '이미 해설이 만들어진 영상은 목록에서 골라 바로 볼 수 있습니다.',
    keys: '카테고리를 골라 원하는 분야의 영상만 볼 수 있어요.',
    mascot: playImg,
  },
  {
    screen: SCREENS.home,
    target: { x: 731, y: 8, w: 406, h: 56 },
    title: '위쪽 메뉴',
    body: '영상 등록, 내 영상, 내 정보, 도움말로 언제든 이동할 수 있습니다.',
    keys: '어디서든 Alt+Shift+H를 누르면 홈으로 와요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.register,
    target: { x: 64, y: 378, w: 960, h: 192 },
    title: '내 영상 직접 올리기',
    body: '가지고 있는 영상 파일을 올리면 AI가 해설을 만들어 드립니다. 파일 고르기, 제목, 공개 범위 3단계로 끝나요.',
    keys: '파일 고르기를 누르거나 영상 파일을 이 상자 위로 끌어다 놓아요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.youtube,
    target: { x: 64, y: 638, w: 880, h: 56 },
    title: '해설 만들기 요청',
    body: '해설이 없는 유튜브 영상은 해설 만들기를 누르면 AI가 영상을 분석해 해설을 만듭니다. 이미 해설이 있으면 바로 볼 수 있어요.',
    keys: '검색 칸에 유튜브 주소를 넣으면 이 화면이 나와요.',
    mascot: clapImg,
  },
  {
    screen: SCREENS.youtube,
    target: { x: 1051, y: 182, w: 310, h: 243 },
    title: '오늘 남은 횟수',
    body: '하루에 해설을 만들 수 있는 횟수가 정해져 있고, 남은 횟수를 여기서 확인할 수 있습니다.',
    keys: '횟수는 밤 12시에 다시 채워져요. 이미 해설이 있는 영상은 횟수를 쓰지 않아요.',
    mascot: smileImg,
  },
  {
    screen: SCREENS.job,
    target: { x: 64, y: 370, w: 960, h: 280 },
    title: '해설 만들기 진행',
    body: 'AI가 영상을 분석하는 동안 진행률과 남은 시간을 보여 드립니다. 다 만들면 바로 볼 수 있어요.',
    keys: '화면을 떠나도 계속 만들어요. 홈 오른쪽 위 카드나 내 영상에서 진행 상황을 다시 볼 수 있어요.',
    mascot: smileImg,
  },
  {
    screen: SCREENS.job,
    target: { x: 64, y: 690, w: 960, h: 288 },
    title: '진행 단계',
    body: '영상 분석, 장면 해설 만들기, 해설 합치고 다듬기, 해설 음성 만들기 순서로 진행됩니다.',
    keys: '지금 하고 있는 단계는 굵은 글자로 표시돼요.',
    mascot: clapImg,
  },
  {
    screen: SCREENS.watch,
    target: { x: 64, y: 219, w: 817, h: 599 },
    title: '영상 재생 및 음성 해설',
    body: '영상의 내용을 AI가 분석하고, 화면에서 일어나는 상황을 음성으로 설명해 드립니다.',
    keys: 'Alt+Shift+K로 재생과 멈춤, Alt+Shift+J와 L로 뒤로·앞으로 움직여요.',
    mascot: clapImg,
  },
  {
    screen: SCREENS.watch,
    target: { x: 64, y: 687, w: 817, h: 63 },
    title: 'AI 해설 확인',
    body: '영상 속 인물의 행동과 주변 상황을 AI 해설을 통해 이해할 수 있습니다.',
    keys: '지금 읽는 해설이 이 상자에 크게 나와요. Alt+Shift+D로 지금 장면을 자세히 들어요.',
    mascot: playImg,
  },
  {
    screen: SCREENS.watch,
    target: { x: 64, y: 834, w: 817, h: 56 },
    title: '상세도와 재생 설정',
    body: '짧은 해설, 기본 해설, 자세한 해설 중에 고르고, 재생 설정에서 말하기 속도 등을 바꿀 수 있습니다.',
    keys: '숫자 1, 2, 3으로 상세도를 바로 바꿀 수 있어요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.watch,
    target: { x: 921, y: 160, w: 440, h: 176 },
    title: 'AI 챗봇 사용하기',
    body: '영상에 대해 궁금한 점을 자유롭게 질문해 보세요. AI가 영상의 맥락을 바탕으로 답변합니다.',
    keys: 'Alt+Shift+Q로 질문 칸으로 가서 말하거나 적어요. 1분 뒤로, 다음 장면 같은 이동 명령도 할 수 있어요.',
    mascot: askImg,
  },
  {
    screen: SCREENS.watch,
    target: { x: 921, y: 360, w: 440, h: 284 },
    title: '목차, 대본, 질문 기록',
    body: '목차로 원하는 장면에 바로 가고, 대본에서 해설 문장을 다시 보고, 질문 기록에서 지난 답을 다시 들을 수 있습니다.',
    keys: '목록에서 장면이나 문장을 고르면 그 시각으로 옮겨요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.myVideos,
    target: { x: 64, y: 160, w: 1297, h: 698 },
    title: '내 영상 모아 보기',
    body: '내가 요청하거나 올린 영상과 즐겨찾기한 영상을 한곳에서 볼 수 있습니다.',
    keys: '위쪽 탭으로 요청·올린 영상과 즐겨찾기를 바꿔 봐요. 만드는 중인 영상은 진행 상황 보기로 확인해요.',
    mascot: smileImg,
  },
  {
    screen: SCREENS.myInfo,
    target: { x: 64, y: 264, w: 880, h: 390 },
    title: '내 정보와 재생 설정',
    body: '계정 정보를 확인하고, 재생 설정을 바꾸고, 시각장애인 인증을 하면 더 긴 영상도 해설을 만들 수 있습니다.',
    keys: '재생 설정은 영상 화면의 재생 설정 버튼에서도 바꿀 수 있어요.',
    mascot: pointImg,
  },
  {
    screen: SCREENS.help,
    target: { x: 64, y: 286, w: 704, h: 56 },
    title: '자유롭게 영상 즐기기',
    body: '이제 준비가 끝났습니다. AI 해설과 챗봇을 활용해 원하는 영상을 자유롭게 감상해 보세요.',
    keys: '단축키, 말로 하는 명령, 이 사용법은 도움말에서 다시 볼 수 있어요. 다음을 누르면 홈으로 가요.',
    mascot: waveImg,
  },
]

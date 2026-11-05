import {
  estimateDisplayProgress,
  jobOverallPercent,
  jobSteps,
  toDisplayProgress,
  uploadOverallPercent,
  uploadSteps,
} from './stages'

const states = (steps: { state: string }[]) => steps.map((s) => s.state)

test('업로드는 전체의 앞 15%, 해설 만들기는 나머지 85%에 이어 붙는다', () => {
  expect(uploadOverallPercent(0)).toBe(0)
  expect(uploadOverallPercent(50)).toBe(7)
  expect(uploadOverallPercent(100)).toBe(15)
  expect(jobOverallPercent('UPLOAD', 0)).toBe(15)
  expect(jobOverallPercent('UPLOAD', 20)).toBe(32)
  expect(jobOverallPercent('UPLOAD', 99)).toBe(99)
  expect(jobOverallPercent('UPLOAD', 100)).toBe(100)
})

test('유튜브는 서버 진행률을 그대로 쓴다', () => {
  expect(jobOverallPercent('YOUTUBE', 0)).toBe(0)
  expect(jobOverallPercent('YOUTUBE', 45.6)).toBe(45)
  expect(jobOverallPercent('YOUTUBE', 130)).toBe(100)
})

test('작업 상태별 단계 상태', () => {
  expect(states(jobSteps('YOUTUBE', { status: 'QUEUED', currentStage: null }))).toEqual([
    'pending',
    'pending',
    'pending',
    'pending',
  ])
  expect(states(jobSteps('UPLOAD', { status: 'QUEUED', currentStage: null }))).toEqual([
    'done',
    'pending',
    'pending',
    'pending',
    'pending',
  ])
  expect(states(jobSteps('YOUTUBE', { status: 'RUNNING', currentStage: 'DESCRIBE' }))).toEqual([
    'done',
    'active',
    'pending',
    'pending',
  ])
  expect(states(jobSteps('UPLOAD', { status: 'PARTIAL', currentStage: 'TTS' }))).toEqual([
    'done',
    'done',
    'done',
    'done',
    'done',
  ])
  expect(states(jobSteps('YOUTUBE', { status: 'FAILED', currentStage: 'TTS' }))).toEqual([
    'done',
    'done',
    'done',
    'failed',
  ])
  // 단계 없이 실패하면 첫 단계에서 멈춘 것으로 본다
  expect(states(jobSteps('UPLOAD', { status: 'FAILED', currentStage: null }))).toEqual([
    'done',
    'failed',
    'pending',
    'pending',
    'pending',
  ])
})

test('올리는 중에는 업로드만 진행 중, 끊기면 멈춤', () => {
  expect(states(uploadSteps('active'))).toEqual([
    'active',
    'pending',
    'pending',
    'pending',
    'pending',
  ])
  expect(states(uploadSteps('failed'))).toEqual([
    'failed',
    'pending',
    'pending',
    'pending',
    'pending',
  ])
})

test('서버 진행률을 걸리는 시간에 맞춘 구간으로 바꾼다', () => {
  expect(toDisplayProgress(0)).toBe(0)
  expect(toDisplayProgress(10)).toBe(37.5) // 영상 분석 0~20 → 0~75
  expect(toDisplayProgress(20)).toBe(75) // 장면 해설 20~70 → 75~80
  expect(toDisplayProgress(70)).toBe(80) // 합치고 다듬기 70~80 → 80~83
  expect(toDisplayProgress(80)).toBe(83) // 음성 80~100 → 83~100
  expect(toDisplayProgress(90)).toBe(91.5)
  expect(toDisplayProgress(100)).toBe(100)
})

test('단계 안에서는 예상 시간에 맞춰 구간의 95%까지만 채우고, 서버 값보다 작아지지 않는다', () => {
  expect(estimateDisplayProgress('PREPARE', 0, 0, 100)).toBe(0)
  expect(estimateDisplayProgress('PREPARE', 0, 50, 100)).toBe(37.5)
  expect(estimateDisplayProgress('PREPARE', 0, 1000, 100)).toBeCloseTo(71.25)
  expect(estimateDisplayProgress('PREPARE', 15, 0, 100)).toBe(56.25)
  expect(estimateDisplayProgress('TTS', 80, 5, 10)).toBe(91.5)
})

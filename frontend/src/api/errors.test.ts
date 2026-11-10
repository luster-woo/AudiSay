import { ApiError, NetworkError, jobError, toUserMessage } from './errors'

test('서버 오류 문구를 그대로 읽는다 (문구 기준은 서버 ErrorCode)', () => {
  expect(toUserMessage(new ApiError('COMMON_001', 400, '입력 문장은 1~500자여야 해요.'))).toBe(
    '입력 문장은 1~500자여야 해요.',
  )
  expect(toUserMessage(new ApiError('USER_001', 409, '이미 사용 중인 이메일이에요.'))).toBe(
    '이미 사용 중인 이메일이에요.',
  )
  // 서버 문구가 비어 있으면(응답 형식이 깨짐) 기본 문구
  expect(toUserMessage(new ApiError('COMMON_004', 500, ''))).toBe(
    '잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.',
  )
  expect(toUserMessage(new NetworkError())).toBe(new NetworkError().message)
})

test('작업 실패 문구는 서버 것을 쓰고, 없거나 모르는 코드면 기본 문구 (화면이 깨지지 않게)', () => {
  expect(jobError('TRANSCODE_FAILED', '영상 파일을 읽을 수 없어요.')).toEqual({
    message: '영상 파일을 읽을 수 없어요.',
    retryable: false,
  })
  expect(jobError('SOMETHING_NEW')).toEqual({
    message: '알 수 없는 오류가 났어요.',
    retryable: true,
  })
  expect(jobError(null).message).toBe('알 수 없는 오류가 났어요.')
  expect(jobError('DURATION_MISMATCH').retryable).toBe(false)
})

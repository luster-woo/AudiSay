import { ApiError, NetworkError, jobError, toUserMessage } from './errors'

test('서버가 이유를 담아 준 문구는 그대로 읽고, 기본 문구면 쉬운 고정 문구를 읽는다', () => {
  expect(toUserMessage(new ApiError('COMMON_001', 400, '입력 문장은 1~500자여야 합니다.'))).toBe(
    '입력 문장은 1~500자여야 합니다.',
  )
  expect(toUserMessage(new ApiError('COMMON_001', 400, '유효하지 않은 요청입니다.'))).toBe(
    '입력한 값을 다시 확인해 주세요.',
  )
  expect(toUserMessage(new ApiError('DESC_001', 404, '아직 해설이 없습니다.'))).toBe(
    '아직 해설이 없습니다.',
  )
  expect(toUserMessage(new ApiError('COMMON_001', 400, ''))).toBe('입력한 값을 다시 확인해 주세요.')
  // 이유별 문구가 없는 코드는 그대로 고정 문구
  expect(toUserMessage(new ApiError('USER_001', 409, '이미 가입된 이메일입니다.'))).toBe(
    '이미 사용 중인 이메일이에요.',
  )
  // 표에 없는 코드는 서버 문구
  expect(toUserMessage(new ApiError('USER_008', 503, '잠시 뒤 다시 올려 주세요.'))).toBe(
    '잠시 뒤 다시 올려 주세요.',
  )
  expect(toUserMessage(new NetworkError())).toBe(new NetworkError().message)
})

test('모르는 작업 실패 코드는 UNKNOWN 문구로 (화면이 깨지지 않게)', () => {
  expect(jobError('SOMETHING_NEW')).toEqual({
    message: '알 수 없는 오류가 났어요.',
    retryable: true,
  })
  expect(jobError(null).message).toBe('알 수 없는 오류가 났어요.')
  expect(jobError('DURATION_MISMATCH').retryable).toBe(false)
})

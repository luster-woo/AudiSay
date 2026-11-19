import { youtubeSrcSet } from './youtubeThumb'

test('유튜브 hqdefault 주소면 mqdefault(320w)·hqdefault(480w) 후보를 만든다', () => {
  expect(youtubeSrcSet('https://i.ytimg.com/vi/-DjykB2XImc/hqdefault.jpg')).toBe(
    'https://i.ytimg.com/vi/-DjykB2XImc/mqdefault.jpg 320w, https://i.ytimg.com/vi/-DjykB2XImc/hqdefault.jpg 480w',
  )
})

test('유튜브가 아닌 주소(업로드 영상 등)는 그대로 둔다', () => {
  expect(
    youtubeSrcSet('https://bucket.s3.ap-northeast-2.amazonaws.com/frames/1/thumb.jpg'),
  ).toBeUndefined()
  expect(youtubeSrcSet('https://i.ytimg.com/vi/abc/maxresdefault.jpg')).toBeUndefined()
})

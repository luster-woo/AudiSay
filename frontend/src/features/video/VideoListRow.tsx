import { useId, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { formatDurationShort } from '@/utils/time'
import { Thumbnail } from './Thumbnail'
import { cn } from '@/components/ui/cn'

export interface VideoListRowProps {
  title: string
  /** 출처 줄 ('유튜브 · 채널' / '직접 올린 영상') */
  source: string
  durationSec: number
  thumbnailUrl: string | null
  to: string
  /** 줄 오른쪽 상태 한 마디 (검색 결과: '해설 있음', '해설 만들 수 없음, 10분 넘음'). 출처·길이 뒤에 설명으로 이어 읽힌다 */
  status?: string
  /** 만들 수 없는 영상은 빨간 테두리·글자로도 구분한다 */
  tone?: 'normal' | 'danger'
  linkRef?: Ref<HTMLAnchorElement>
}

/**
 * 한 열 목록의 영상 한 줄 (홈·검색 결과). ol 안의 li 로 쓴다. 화면 번호는 두지 않고, 낭독기는 목록 위치("10개 중 3번째")로 듣는다.
 * 링크는 h3 제목 안에 두고 ::after 로 줄 전체를 덮어(stretched link) 마우스로는 어디를 눌러도 열린다.
 * 링크 이름은 제목만이라 Tab·링크 목록으로 훑을 때 짧게 읽히고, 출처·길이(·상태)는 설명(aria-describedby)으로 이어 읽힌다.
 * 제목이 링크를 감싸야 H·3 키로 잡힌다: 링크가 h3 를 감싸고 aria-labelledby 로 이름을 빌리면 크롬이 그 h3 를
 * 이름으로만 쓰고 접근성 트리에서 숨겨 제목 탐색이 안 된다 (11-09 NVDA 실측)
 */
export function VideoListRow({
  title,
  source,
  durationSec,
  thumbnailUrl,
  to,
  status,
  tone = 'normal',
  linkRef,
}: VideoListRowProps) {
  const metaId = useId()
  const statusId = useId()
  return (
    <div
      className={cn(
        'relative flex items-center gap-5 rounded-lg border-2 bg-paper px-5 py-4 text-ink focus-within:bg-yellow-soft',
        tone === 'danger' ? 'border-danger' : 'border-line',
      )}
    >
      <Thumbnail src={thumbnailUrl} className="hidden w-40 shrink-0 rounded-md sm:block" />
      <div className="min-w-0 flex-1">
        <h3 className="text-[1.375rem] leading-snug font-bold">
          <Link
            ref={linkRef}
            to={to}
            aria-describedby={status ? `${metaId} ${statusId}` : metaId}
            className="text-ink no-underline after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {title}
          </Link>
        </h3>
        <p id={metaId} className="mt-1 text-xl">
          {source} · {formatDurationShort(durationSec)}
        </p>
      </div>
      {status && (
        <p
          id={statusId}
          className={cn(
            // 고정 폭: 상태 글자 길이('해설 있음' / '해설 만들 수 없음, 10분 넘음')와 상관없이 줄마다 제목 폭이 같게
            'w-[12rem] max-w-[40%] shrink-0 text-right text-xl font-bold',
            tone === 'danger' ? 'text-danger' : 'text-navy',
          )}
        >
          {status}
        </p>
      )}
    </div>
  )
}

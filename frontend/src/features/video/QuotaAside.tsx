import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import type { QuotaItem } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

function Row({ label, item }: { label: string; item: QuotaItem }) {
  const unlimited = item.limit == null
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-2xl text-ink">{label}</dt>
      {/* 숫자는 같은 폭(tabular-nums)으로 오른쪽 정렬해 두 줄의 숫자 위치를 맞춘다. 색은 늘 검정 */}
      <dd className="min-w-[5.5rem] text-right text-2xl font-bold text-ink tabular-nums">
        {unlimited ? (
          '제한 없음'
        ) : (
          <>
            {/* '4 / 5' 는 '4 슬래시 5'로 읽히므로 화면용과 낭독용을 나눈다 (원칙 11장) */}
            <span aria-hidden="true">
              {item.remaining} / {item.limit}
            </span>
            <span className="sr-only">
              {item.limit}번 중 {item.remaining}번 남음
            </span>
          </>
        )}
      </dd>
    </div>
  )
}

/** 오른쪽 '오늘 남은 횟수'. GET /users/me/quota */
export function QuotaAside({
  showLeftNote = true,
  className,
}: {
  showLeftNote?: boolean
  className?: string
}) {
  const { data, isPending, refetch } = useQuery({
    queryKey: queryKeys.quota,
    queryFn: usersApi.quota,
  })

  return (
    <aside aria-labelledby="quota-title" className={cn('border-t-2 border-line pt-5', className)}>
      <h2 id="quota-title" className="text-[1.75rem] font-bold">
        오늘 남은 횟수
      </h2>
      {data ? (
        <dl className="mt-4">
          <Row label="유튜브 해설" item={data.youtube} />
          {/* 업로드 영상의 해설 요청 횟수 (업로드를 마쳐 해설 만들기가 시작될 때 차감) */}
          <Row label="내 영상 해설" item={data.upload} />
        </dl>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-lg text-ink-muted">
            {isPending ? '불러오는 중이에요.' : '남은 횟수를 불러오지 못했어요.'}
          </p>
          {!isPending && (
            <Button variant="secondary" onClick={() => void refetch()}>
              횟수 다시 불러오기
            </Button>
          )}
        </div>
      )}
      <p className="mt-6 text-xl leading-relaxed">
        {showLeftNote && '남은 횟수예요. '}밤 12시에 다시 채워져요.
      </p>
    </aside>
  )
}

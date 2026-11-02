import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import type { QuotaItem } from '@/api/types'
import { cn } from '@/components/ui/cn'

function Row({ label, item }: { label: string; item: QuotaItem }) {
  const unlimited = item.limit == null
  const empty = !unlimited && item.remaining === 0
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-2xl">{label}</dt>
      <dd className={cn('text-2xl font-bold', empty ? 'text-danger' : 'text-ink')}>
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
  const { data } = useQuery({ queryKey: queryKeys.quota, queryFn: usersApi.quota })

  return (
    <aside aria-labelledby="quota-title" className={cn('border-t-2 border-line pt-5', className)}>
      <h2 id="quota-title" className="text-[1.75rem] font-bold">
        오늘 남은 횟수
      </h2>
      {data ? (
        <dl className="mt-4">
          <Row label="유튜브 해설" item={data.youtube} />
          <Row label="영상 올리기" item={data.upload} />
        </dl>
      ) : (
        <p className="mt-4 text-lg text-ink-muted">불러오는 중이에요.</p>
      )}
      <p className="mt-6 text-xl leading-relaxed">
        {showLeftNote && (
          <>
            남은 횟수예요.
            <br />
          </>
        )}
        밤 12시(한국 시간)에
        <br />
        다시 채워져요.
      </p>
    </aside>
  )
}

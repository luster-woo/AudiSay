import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { queryKeys } from '@/api/queryKeys'
import type { Role } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { RoleFilter } from '@/features/admin/RoleFilter'
import { formatJoinedAt, ROLE_LABELS, ROLE_MARK } from '@/features/admin/users'
import { useAnnouncer } from '@/features/announcer/context'
import { usePageEntry } from '@/features/page/usePageEntry'

/** Figma 한 쪽 10명 (서버 기본 20, 최대 50) */
const PAGE_SIZE = 10

/** 표 칸 안쪽 여백 (Figma 12px) */
const CELL = 'px-[0.8rem] text-left'

/** 회원 (ADM-03): 역할로 거르고 이메일·이름으로 찾는다. 보기만 한다 */
export default function UsersPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const inputId = useId()
  const { announce } = useAnnouncer()
  const [role, setRole] = useState<Role | undefined>()
  const [draft, setDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)

  const params = { role, keyword: keyword || undefined, page, size: PAGE_SIZE }
  const { data, isError, isFetching } = useQuery({
    queryKey: queryKeys.admin.users(params),
    queryFn: () => adminApi.users(params),
    placeholderData: keepPreviousData,
  })

  // '전체'는 서버가 관리자까지 세어 준다. 관리자는 목록에서 빼기로 해서(Figma)
  // 같은 검색어의 관리자 수를 따로 받아 줄과 인원수에서 뺀다
  const hideAdmin = role === undefined
  const adminParams = { role: 'ADMIN' as const, keyword: params.keyword, size: 1 }
  const admins = useQuery({
    queryKey: queryKeys.admin.users(adminParams),
    queryFn: () => adminApi.users(adminParams),
    enabled: hideAdmin,
  })
  const adminCount = hideAdmin ? (admins.data?.page.totalElements ?? 0) : 0
  const pageInfo = data && {
    ...data.page,
    totalElements: data.page.totalElements - adminCount,
    last:
      data.page.last ||
      (data.page.number + 1) * data.page.size >= data.page.totalElements - adminCount,
  }
  const fetching = isFetching || (hideAdmin && admins.isFetching)
  const total = pageInfo?.totalElements

  // 처음 한 번만 제목으로 포커스를 옮긴다. 이전 결과를 붙잡고 있어 역할·쪽을 바꿔도 data 는 비지 않는다
  usePageEntry({
    title: '회원',
    announce: '회원 화면이에요. 역할로 거르거나 이메일·이름으로 찾을 수 있어요.',
    focusRef: headingRef,
    ready: data !== undefined || isError,
  })

  // 역할·검색어를 바꾸면 결과가 도착한 뒤 몇 명인지 읽어 준다
  const pendingAnnounce = useRef(false)
  useEffect(() => {
    if (!pendingAnnounce.current || fetching || total === undefined) return
    pendingAnnounce.current = false
    announce(total === 0 ? '찾는 회원이 없어요.' : `회원 ${total}명을 찾았어요.`)
  }, [total, fetching, announce])

  const changeRole = (next: Role | undefined) => {
    setRole(next)
    setPage(0)
    pendingAnnounce.current = true
  }
  const search = (e: FormEvent) => {
    e.preventDefault()
    setKeyword(draft.trim())
    setPage(0)
    pendingAnnounce.current = true
  }
  const changePage = (next: number) => {
    setPage(next)
    listHeadingRef.current?.focus()
  }

  const users = (data?.content ?? []).filter((u) => !hideAdmin || u.role !== 'ADMIN')

  // 치수는 Figma /admin/users 프레임 기준 (관리자 글자 크기 15px = 1rem)
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[1.4667rem] leading-snug font-bold outline-none"
          >
            회원
          </h1>
          <p className="mt-[0.1333rem] text-[0.9333rem] text-ink-muted">
            가입한 회원을 찾아봐요. 보기만 할 수 있어요.
          </p>
        </div>
        {total !== undefined && (
          <p className="text-[0.9333rem] font-bold">
            {role ? ROLE_LABELS[role] : '전체'} {total}명
          </p>
        )}
      </div>

      <div className="mt-[1.2rem] flex items-end gap-[0.8667rem]">
        <RoleFilter value={role} onChange={changeRole} />
        <form
          role="search"
          aria-label="회원 찾기"
          onSubmit={search}
          className="flex flex-1 items-end gap-[0.8667rem]"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <label htmlFor={inputId} className="text-[0.8667rem] text-ink-muted">
              이메일 또는 이름
            </label>
            <input
              id={inputId}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="예: haneul"
              className="mt-[0.5333rem] h-[2.5333rem] min-h-0 rounded-sm border-2 border-ink-muted/70 bg-paper px-[1rem] text-[0.9333rem] focus-visible:border-ink"
            />
          </div>
          <Button type="submit" size="sm" className="min-h-[2.6667rem] px-[1rem]">
            검색
          </Button>
        </form>
      </div>

      <section
        aria-labelledby="user-list-title"
        className="mt-[1.4667rem] overflow-hidden rounded-sm border border-line bg-paper"
      >
        <h2 id="user-list-title" ref={listHeadingRef} tabIndex={-1} className="sr-only">
          회원 목록
        </h2>
        {isError ? (
          <p className="px-[0.8rem] py-6">회원 목록을 불러오지 못했어요.</p>
        ) : !pageInfo ? (
          <p className="px-[0.8rem] py-6">회원 목록을 불러오는 중이에요.</p>
        ) : (
          <>
            <table className="w-full table-fixed text-[0.9333rem]">
              <colgroup>
                <col className="w-[9.3333rem]" />
                <col />
                <col className="w-[9.3333rem]" />
                <col className="w-[8rem]" />
                <col className="w-[8.0667rem]" />
              </colgroup>
              <thead className="bg-cream text-[0.8667rem] text-ink-muted">
                <tr className="h-[2.6667rem]">
                  <th scope="col" className={`${CELL} font-normal`}>
                    이름
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    이메일
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    역할
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    인증일
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    가입일
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} className="h-[3.2667rem] border-b border-line">
                    <th scope="row" className={`${CELL} truncate font-bold`}>
                      {u.name}
                    </th>
                    <td className={`${CELL} truncate`}>{u.email}</td>
                    <td className={CELL}>
                      <span className="flex items-center gap-[0.5333rem] font-bold">
                        <span
                          aria-hidden="true"
                          className="flex size-[0.6rem] items-center justify-center"
                        >
                          <span className={ROLE_MARK[u.role]} />
                        </span>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className={`${CELL} font-mono text-[0.8667rem]`}>
                      {u.verifiedAt ? (
                        formatJoinedAt(u.verifiedAt)
                      ) : (
                        <>
                          <span aria-hidden="true">–</span>
                          <span className="sr-only">인증 안 함</span>
                        </>
                      )}
                    </td>
                    <td className={`${CELL} font-mono text-[0.8667rem]`}>
                      {formatJoinedAt(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <p className="px-[0.8rem] py-6">
                {keyword || role ? '찾는 회원이 없어요.' : '아직 가입한 회원이 없어요.'}
              </p>
            )}
            <Pagination
              page={pageInfo}
              onChange={changePage}
              unit="명"
              note="가입 최신순"
              size="sm"
              className="px-[0.8rem] py-[0.8333rem]"
            />
          </>
        )}
      </section>
    </div>
  )
}

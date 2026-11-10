import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { queryKeys } from '@/api/queryKeys'
import type { AdminUser, Role } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { AdminPagination } from '@/features/admin/AdminPagination'
import { RoleFilter } from '@/features/admin/RoleFilter'
import {
  formatJoinedAt,
  ROLE_LABELS,
  ROLE_MARK,
  SERVER_SORT,
  USER_SORT_OPTIONS,
  type UserSort,
} from '@/features/admin/users'
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
  const sortId = useId()
  const { announce } = useAnnouncer()
  const [role, setRole] = useState<Role | undefined>()
  const [draft, setDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<UserSort>('default')

  // 서버가 거르고·정렬하고·쪽을 나눈 그대로 보인다 (관리자 회원도 빼지 않는다, 쪽 수도 서버 값 그대로).
  // 예전에는 '전체'에서 관리자를 화면에서만 빼고 쪽 수를 다시 계산해 마지막 쪽 회원을 볼 수 없었다
  const params = {
    role,
    keyword: keyword || undefined,
    sort: SERVER_SORT[sort],
    page,
    size: PAGE_SIZE,
  }
  const {
    data,
    isError,
    isFetching: fetching,
  } = useQuery({
    queryKey: queryKeys.admin.users(params),
    queryFn: () => adminApi.users(params),
    // 역할·정렬·쪽을 바꾸는 동안 이전 표를 그대로 둔다 (표가 잠깐 사라지지 않게)
    placeholderData: keepPreviousData,
  })
  const pageInfo = data?.page
  const total = pageInfo?.totalElements

  // 화면 진입(제목 포커스·안내)은 처음 한 번만. 정렬·역할을 바꾸며 데이터가 다시 비어도 제목으로 튀지 않게 고정한다
  const [entered, setEntered] = useState(false)
  if (!entered && (data !== undefined || isError)) setEntered(true)
  usePageEntry({
    title: '회원',
    announce: '회원 화면이에요. 역할로 거르거나 이메일·이름으로 찾을 수 있어요.',
    focusRef: headingRef,
    ready: entered,
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
  const changeSort = (next: UserSort) => {
    setSort(next)
    setPage(0)
    // 포커스는 정렬 칸에 그대로 두고, 결과만 알린다
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

  const users: AdminUser[] = data?.content ?? []

  // 치수는 Figma /admin/users 프레임 기준 (관리자 글자 크기 15px = 1rem)
  return (
    <div>
      <div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.4667rem] leading-snug font-bold outline-none"
        >
          회원
        </h1>
      </div>

      {/* 왼쪽부터 역할 · 검색 · 정렬. 오른쪽 남는 공간은 비워 둔다 */}
      <div className="mt-[1.2rem] flex flex-wrap items-end gap-[0.8667rem]">
        <RoleFilter value={role} onChange={changeRole} />
        <form
          role="search"
          aria-label="회원 찾기"
          onSubmit={search}
          className="flex items-end gap-[0.8667rem]"
        >
          <div className="flex w-[28rem] max-w-full min-w-0 flex-col">
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
        <div className="flex flex-col">
          <label htmlFor={sortId} className="text-[0.8667rem] text-ink-muted">
            정렬
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => changeSort(e.target.value as UserSort)}
            className="mt-[0.5333rem] h-[2.5333rem] min-h-0 rounded-sm border-2 border-ink-muted/70 bg-paper px-[0.8rem] text-[0.9333rem] focus-visible:border-ink"
          >
            {USER_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
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
            <AdminPagination
              page={pageInfo.number}
              totalPages={pageInfo.totalPages}
              onChange={changePage}
              className="px-[0.8rem] py-[0.8333rem]"
            />
          </>
        )}
      </section>
    </div>
  )
}

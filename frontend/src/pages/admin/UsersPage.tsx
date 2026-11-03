import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { queryKeys } from '@/api/queryKeys'
import type { AdminUser, Role } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { AdminPagination } from '@/features/admin/AdminPagination'
import { RoleFilter } from '@/features/admin/RoleFilter'
import {
  fetchAllUsers,
  formatJoinedAt,
  ROLE_LABELS,
  ROLE_MARK,
  sortUsers,
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

  // 기본: 서버 순서(가입 최신순) 그대로 쪽마다 받는다
  const serverSorted = sort === 'default'
  const params = { role, keyword: keyword || undefined, page, size: PAGE_SIZE }
  const paged = useQuery({
    queryKey: queryKeys.admin.users(params),
    queryFn: () => adminApi.users(params),
    placeholderData: keepPreviousData,
    enabled: serverSorted,
  })
  // 그 밖의 정렬: 서버(GET /admin/users)에 정렬 값이 없어 같은 조건의 회원을 모두 받아 화면에서 정렬·쪽 나눔
  const allParams = { role, keyword: keyword || undefined }
  const all = useQuery({
    queryKey: [...queryKeys.admin.users(allParams), 'all'],
    queryFn: () => fetchAllUsers(allParams),
    placeholderData: keepPreviousData,
    enabled: !serverSorted,
  })
  const localPage = (() => {
    if (serverSorted || !all.data) return undefined
    const list = sortUsers(
      all.data.filter((u) => role !== undefined || u.role !== 'ADMIN'),
      sort,
    )
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
    const number = Math.min(page, totalPages - 1)
    return {
      content: list.slice(number * PAGE_SIZE, (number + 1) * PAGE_SIZE),
      page: {
        number,
        size: PAGE_SIZE,
        totalElements: list.length,
        totalPages,
        first: number === 0,
        last: number >= totalPages - 1,
      },
    }
  })()
  const data = serverSorted ? paged.data : localPage
  const isError = serverSorted ? paged.isError : all.isError
  const isFetching = serverSorted ? paged.isFetching : all.isFetching

  // '전체'는 서버가 관리자까지 세어 준다. 관리자는 목록에서 빼기로 해서(Figma)
  // 같은 검색어의 관리자 수를 따로 받아 줄과 인원수에서 뺀다
  const hideAdmin = role === undefined && serverSorted
  const adminParams = { role: 'ADMIN' as const, keyword: params.keyword, size: 1 }
  const admins = useQuery({
    queryKey: queryKeys.admin.users(adminParams),
    queryFn: () => adminApi.users(adminParams),
    enabled: role === undefined,
  })
  const adminCount = hideAdmin ? (admins.data?.page.totalElements ?? 0) : 0
  const pageInfo = data && {
    ...data.page,
    totalElements: data.page.totalElements - adminCount,
    totalPages: Math.max(1, Math.ceil((data.page.totalElements - adminCount) / data.page.size)),
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
  const changeSort = (next: UserSort) => {
    setSort(next)
    setPage(0)
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

  const users: AdminUser[] = (data?.content ?? []).filter((u) => !hideAdmin || u.role !== 'ADMIN')

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

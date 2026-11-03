import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { useAuth } from '@/features/auth/context'
import { useAudio } from '@/features/audio/useAudio'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useSettings } from '@/features/settings/context'
import { QuotaAside } from '@/features/video/QuotaAside'
import { SettingsDialog } from '@/pages/watch/SettingsDialog'
import { PasswordChangeDialog } from './PasswordChangeDialog'
import { WithdrawDialog } from './WithdrawDialog'

const ROLE_LABELS = {
  GENERAL: '일반 회원',
  VISUALLY_IMPAIRED: '시각장애인 인증',
  ADMIN: '관리자',
} as const
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export default function MyInfoPage() {
  const { logout } = useAuth()
  const { announce, setMuted } = useAnnouncer()
  const { settings } = useSettings()
  const { play, stop } = useAudio()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const logoutBusy = useRef(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [dialog, setDialog] = useState<'password' | 'settings' | 'withdraw' | null>(null)
  const profile = useQuery({ queryKey: queryKeys.me, queryFn: usersApi.me })
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: usersApi.settings })
  const me = profile.data

  usePageEntry({
    title: '내 정보',
    announce: '내 정보예요. 계정 정보와 설정을 확인하고 바꿀 수 있어요.',
    focusRef: headingRef,
  })

  useEffect(() => {
    if (profile.isError)
      announce('내 정보를 불러오지 못했어요. 다시 시도해 주세요.', { politeness: 'assertive' })
  }, [profile.isError, announce])

  useEffect(() => () => setMuted(false), [setMuted])

  const closeDialog = () => {
    stop()
    setMuted(false)
    setDialog(null)
  }

  const preview = () => {
    setMuted(true)
    void play(null, {
      text: '안녕하세요. 지금 설정한 속도로 해설을 읽어 드려요.',
      rate: settings.speechRate,
      onEnd: () => setMuted(false),
    })
  }

  const signOut = async () => {
    if (logoutBusy.current) return
    logoutBusy.current = true
    setLoggingOut(true)
    try {
      await logout()
    } catch {
      // 서버 연결이 실패해도 AuthProvider 가 토큰·사용자·캐시를 함께 비운다.
      announce(
        '이 기기의 로그인 정보를 지웠어요. 서버 연결이 실패해 새로고침하면 다시 로그인될 수 있어요.',
        { politeness: 'assertive' },
      )
    } finally {
      logoutBusy.current = false
      setLoggingOut(false)
    }
  }

  const verifiedDate = me?.verifiedAt ? new Date(me.verifiedAt) : null
  const card = 'rounded-md border-2 border-line bg-paper px-6 py-3'
  const row = 'grid items-center gap-x-6 gap-y-2 sm:grid-cols-[10.5rem_minmax(0,1fr)]'

  return (
    <div className="grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,55rem)_19.375rem] lg:justify-between lg:gap-16">
      <div className="min-w-0">
        <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold outline-none">
          내 정보
        </h1>

        <section
          aria-labelledby="account-info"
          className={`${card} mt-16`}
          aria-busy={profile.isPending}
        >
          <h2 id="account-info" className="text-[1.75rem] font-bold text-navy">
            계정 정보
          </h2>
          {profile.isPending && <p className="mt-6 text-xl">내 정보를 불러오는 중이에요.</p>}
          {profile.isError && (
            <div className="mt-6 space-y-4">
              <p className="text-xl">내 정보를 불러오지 못했어요.</p>
              <Button variant="secondary" size="xl" onClick={() => void profile.refetch()}>
                다시 불러오기
              </Button>
            </div>
          )}
          {me && (
            <dl className="mt-4 space-y-3 text-2xl leading-normal">
              <div className={row}>
                <dt className="font-bold">이름</dt>
                <dd className="min-w-0 wrap-anywhere">{me.name}</dd>
              </div>
              <div className={row}>
                <dt className="font-bold">이메일</dt>
                <dd className="min-w-0 wrap-anywhere">{me.email}</dd>
              </div>
              <div className={row}>
                <dt className="font-bold">회원 등급</dt>
                <dd className="min-w-0">
                  {ROLE_LABELS[me.role]}
                  {me.verified && verifiedDate && !Number.isNaN(verifiedDate.getTime()) && (
                    <>
                      {' '}
                      · <time dateTime={me.verifiedAt!}>{dateFormatter.format(verifiedDate)}</time>
                    </>
                  )}
                </dd>
              </div>
              <div className={`${row} pt-2`}>
                <dt className="font-bold">비밀번호</dt>
                <dd className="flex flex-wrap items-center justify-between gap-4">
                  <span>
                    <span aria-hidden="true">••••••••</span>
                    <span className="sr-only">보안을 위해 표시하지 않음</span>
                  </span>
                  <Button variant="secondary" size="xl" onClick={() => setDialog('password')}>
                    비밀번호 바꾸기
                  </Button>
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section aria-labelledby="account-settings" className={`${card} mt-7 w-full max-w-[30rem]`}>
          <h2 id="account-settings" className="text-[1.75rem] font-bold text-navy">
            설정
          </h2>
          <dl className="mt-5 space-y-4 text-2xl">
            <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <dt className="font-bold">재생 설정</dt>
              <dd>
                <Button
                  variant="secondary"
                  size="xl"
                  className="w-full"
                  disabled={!settingsQuery.isSuccess}
                  onClick={() => setDialog('settings')}
                >
                  재생 설정 바꾸기
                </Button>
              </dd>
            </div>
            <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <dt className="font-bold">사용법</dt>
              <dd>
                <ButtonLink to="/tutorial/1" variant="secondary" size="xl" className="w-full">
                  사용법 다시 듣기
                </ButtonLink>
              </dd>
            </div>
          </dl>
          {settingsQuery.isPending && <p className="mt-4 text-lg">설정을 불러오는 중이에요.</p>}
          {settingsQuery.isError && (
            <div className="mt-4 space-y-3">
              <p className="text-lg">설정을 불러오지 못했어요.</p>
              <Button variant="secondary" onClick={() => void settingsQuery.refetch()}>
                설정 다시 불러오기
              </Button>
            </div>
          )}
        </section>

        <div className="mt-5 flex flex-wrap gap-5">
          <Button
            variant="secondary"
            size="xl"
            className="min-w-48"
            loading={loggingOut}
            onClick={() => void signOut()}
          >
            {loggingOut ? '로그아웃 중' : '로그아웃'}
          </Button>
          <Button
            variant="danger"
            size="xl"
            className="min-w-48"
            onClick={() => setDialog('withdraw')}
          >
            회원 탈퇴
          </Button>
        </div>
      </div>

      <div className="min-w-0 space-y-14">
        <QuotaAside showLeftNote={false} />
        <aside aria-labelledby="my-info-help" className="border-t border-line pt-5">
          <h2 id="my-info-help" className="text-[1.75rem] font-bold">
            도움
          </h2>
          <p className="mt-4 text-[1.375rem] leading-relaxed">
            Alt+Shift+/를 누르면 현재 화면의 단축키를 읽어 드려요.
          </p>
        </aside>
      </div>

      <PasswordChangeDialog open={dialog === 'password'} onClose={closeDialog} />
      <WithdrawDialog open={dialog === 'withdraw'} onClose={closeDialog} />
      <SettingsDialog open={dialog === 'settings'} onClose={closeDialog} onPreview={preview} />
    </div>
  )
}

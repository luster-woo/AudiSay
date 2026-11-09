import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useAnnouncer } from '@/features/announcer/context'
import { useAudio } from '@/features/audio/useAudio'
import { usePageEntry } from '@/features/page/usePageEntry'
import { useSettings } from '@/features/settings/context'
import { QuotaAside } from '@/features/video/QuotaAside'
import { SettingsDialog } from '@/pages/watch/SettingsDialog'
import { PasswordChangeDialog } from './PasswordChangeDialog'
import { WithdrawDialog } from './WithdrawDialog'

const ROLE_LABELS = {
  GENERAL: '일반 회원',
  VISUALLY_IMPAIRED: 'VIP',
  ADMIN: '관리자',
} as const

export default function MyInfoPage() {
  const { announce, setMuted } = useAnnouncer()
  const { settings } = useSettings()
  const { play, stop } = useAudio()
  const headingRef = useRef<HTMLHeadingElement>(null)
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

  const card = '@container rounded-md border-2 border-line bg-paper px-4 py-3 sm:px-6'
  const row = 'grid items-center gap-x-6 gap-y-2 @min-[34rem]:grid-cols-[10.5rem_minmax(0,1fr)]'

  return (
    <div className="grid min-w-0 items-start gap-10 max-sm:-mx-10 lg:grid-cols-[minmax(0,55rem)_19.375rem] lg:justify-between lg:gap-16">
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
                <dd className="flex min-w-0 flex-wrap items-center justify-between gap-4">
                  <span className="min-w-0 wrap-anywhere">{ROLE_LABELS[me.role]}</span>
                  {me.role === 'GENERAL' && !me.verified && (
                    <ButtonLink
                      to="/verify"
                      variant="secondary"
                      size="xl"
                      className="w-[14.375rem] max-w-full"
                    >
                      시각장애인 인증
                    </ButtonLink>
                  )}
                  {/* 인증을 마쳤으면 같은 자리에 누를 수 없는 '인증 완료'를 둔다 (aria-disabled 라 Tab·낭독은 된다) */}
                  {(me.role === 'VISUALLY_IMPAIRED' || me.verified) && (
                    <Button
                      variant="secondary"
                      size="xl"
                      className="w-[14.375rem] max-w-full"
                      disabled
                    >
                      인증 완료
                    </Button>
                  )}
                </dd>
              </div>
              <div className={`${row} pt-2`}>
                <dt className="font-bold">비밀번호</dt>
                <dd className="flex min-w-0 flex-wrap items-center justify-between gap-4">
                  <span>
                    <span aria-hidden="true">••••••••</span>
                    <span className="sr-only">보안을 위해 표시하지 않음</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="xl"
                    className="w-[14.375rem] max-w-full"
                    onClick={() => setDialog('password')}
                  >
                    비밀번호 바꾸기
                  </Button>
                </dd>
              </div>
              {/* 설정도 계정 정보 목록 안에서 같은 크기의 버튼으로 연다 (창 제목도 '설정') */}
              <div className={`${row} pt-2`}>
                <dt className="font-bold">설정</dt>
                <dd className="flex min-w-0 flex-wrap items-center justify-between gap-4">
                  <span className="flex min-w-0 flex-wrap items-center gap-3 text-xl text-ink-muted">
                    {settingsQuery.isPending && '설정을 불러오는 중이에요.'}
                    {settingsQuery.isError && (
                      <>
                        설정을 불러오지 못했어요.
                        <Button variant="secondary" onClick={() => void settingsQuery.refetch()}>
                          설정 다시 불러오기
                        </Button>
                      </>
                    )}
                  </span>
                  <Button
                    variant="secondary"
                    size="xl"
                    className="w-[14.375rem] max-w-full"
                    disabled={!settingsQuery.isSuccess}
                    onClick={() => setDialog('settings')}
                  >
                    설정 바꾸기
                  </Button>
                </dd>
              </div>
            </dl>
          )}
        </section>

        <div className="mt-5 flex flex-wrap gap-5">
          {/* 로그아웃은 헤더(이름 오른쪽)로 옮겼다. 되돌릴 수 없는 탈퇴만 여기에 둔다 */}
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
      <SettingsDialog
        open={dialog === 'settings'}
        onClose={closeDialog}
        onPreview={preview}
        context="me"
      />
    </div>
  )
}

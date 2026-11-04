import type { ReactNode } from 'react'
import type { UserSettings } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { ChoiceGroup } from '@/components/ui/ChoiceGroup'
import { Dialog } from '@/components/ui/Dialog'
import { Stepper } from '@/components/ui/Stepper'
import { useAnnouncer } from '@/features/announcer/context'
import { useSettings } from '@/features/settings/context'

const DETAIL: { value: UserSettings['detailLevel']; label: string }[] = [
  { value: 1, label: '1 짧은 해설' },
  { value: 2, label: '2 기본 해설' },
  { value: 3, label: '3 자세한 해설' },
]
const MODE: { value: UserSettings['narrationMode']; label: string }[] = [
  { value: 'AUTO', label: '자동' },
  { value: 'WITH_VIDEO', label: '영상과 함께' },
  { value: 'PAUSE_AFTER', label: '멈추고' },
]
const MIX: { value: UserSettings['soundMix']; label: string }[] = [
  { value: 'DIALOGUE_AND_NARRATION', label: '대사 + 해설' },
  { value: 'DIALOGUE_ONLY', label: '대사만' },
]
const SUBTITLE: { value: UserSettings['subtitleReading']; label: string }[] = [
  { value: 'ALL', label: '모두' },
  { value: 'DIFFERENT_ONLY', label: '다른 것만' },
  { value: 'OFF', label: '끄기' },
]
const SEEK: { value: UserSettings['seekStepSec']; label: string }[] = [
  { value: 5, label: '5초' },
  { value: 10, label: '10초' },
  { value: 30, label: '30초' },
]
const SUMMARY: { value: UserSettings['summaryMode']; label: string }[] = [
  { value: 'ASK', label: '묻기' },
  { value: 'ALWAYS', label: '항상' },
  { value: 'NEVER', label: '안 듣기' },
]
const FONT = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))

const labelOf = <T,>(list: readonly { value: T; label: string }[], v: T) =>
  list.find((o) => o.value === v)?.label ?? String(v)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-md border-2 border-navy [&>*+*]:border-t [&>*+*]:border-line"
    >
      <h3 className="bg-navy px-5 py-3 text-lg font-bold text-cream">{title}</h3>
      {children}
    </section>
  )
}

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** '미리 듣기' — 지금 속도로 한 문장 읽기 */
  onPreview: () => void
}

/**
 * 재생 설정 창 (원칙 6장: 영상 위에 떠도 영상을 멈추지 않는다).
 * 바꾸면 바로 저장되고 보던 영상에도 바로 적용된다. 바뀐 결과는 전광판으로 한 줄만 알린다.
 * 처음 포커스는 오른쪽 위 닫기 버튼 (입장 안내 "닫기 버튼에 있어요" 와 맞춘다).
 */
export function SettingsDialog({ open, onClose, onPreview }: SettingsDialogProps) {
  const { settings, update } = useSettings()
  const { announce } = useAnnouncer()

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K], said: string) => {
    void update({ [key]: value } as Partial<UserSettings>)
      .then(() => announce(said))
      .catch(() => {
        /* 저장 실패·원복 안내는 SettingsProvider 가 맡는다 */
      })
  }
  const row = 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="재생 설정"
      description="바꾸면 바로 저장되고, 보던 영상에도 바로 적용돼요. 닫기는 Esc."
      className="overflow-y-auto p-10"
    >
      <div className="space-y-6">
        <Section title="해설">
          <ChoiceGroup
            legend="해설 상세도"
            options={DETAIL}
            value={settings.detailLevel}
            onChange={(v) => set('detailLevel', v, `해설 상세도 ${labelOf(DETAIL, v)}.`)}
            className={row}
          />
          <ChoiceGroup
            legend="해설 방식"
            options={MODE}
            value={settings.narrationMode}
            onChange={(v) => set('narrationMode', v, `해설 방식 ${labelOf(MODE, v)}.`)}
            className={row}
          />
          {/* 해설 목소리 줄은 뺐다 (고를 목소리가 하나뿐). 미리 듣기는 속도를 바로 들어 보도록 속도 줄로 옮겼다 */}
          <div className={row}>
            <Stepper
              label="말하기 속도"
              value={settings.speechRate}
              min={0.5}
              max={2.5}
              step={0.1}
              format={(v) => `${v.toFixed(1)}배`}
              onChange={(v) => void update({ speechRate: v }).catch(() => {})}
              className="flex-1 justify-between"
            />
            <Button variant="ghost" onClick={onPreview}>
              미리 듣기
            </Button>
          </div>
        </Section>

        <Section title="소리">
          <ChoiceGroup
            legend="들을 소리"
            options={MIX}
            value={settings.soundMix}
            onChange={(v) =>
              set(
                'soundMix',
                v,
                v === 'DIALOGUE_ONLY'
                  ? '대사만 들려요. 해설은 읽지 않아요.'
                  : '대사와 해설을 함께 들려요.',
              )
            }
            className={row}
          />
          <Stepper
            label="영상 소리 크기"
            value={settings.originalVolume}
            min={0}
            max={100}
            step={10}
            format={(v) => `${v}%`}
            decreaseLabel="영상 소리 크기 줄이기"
            increaseLabel="영상 소리 크기 키우기"
            onChange={(v) => void update({ originalVolume: v }).catch(() => {})}
            className={row}
          />
          <ChoiceGroup
            legend="자막 읽기"
            options={SUBTITLE}
            value={settings.subtitleReading}
            onChange={(v) => set('subtitleReading', v, `자막 읽기 ${labelOf(SUBTITLE, v)}.`)}
            className={row}
          />
        </Section>

        <Section title="화면 · 재생">
          <ChoiceGroup
            legend="앞뒤 이동 간격"
            options={SEEK}
            value={settings.seekStepSec}
            onChange={(v) => set('seekStepSec', v, `앞뒤 이동 간격 ${v}초.`)}
            className={row}
          />
          <ChoiceGroup
            legend="보기 전 30초 요약"
            options={SUMMARY}
            value={settings.summaryMode}
            onChange={(v) => set('summaryMode', v, `보기 전 30초 요약, ${labelOf(SUMMARY, v)}.`)}
            className={row}
          />
          <ChoiceGroup
            legend="글자 크기"
            options={FONT}
            value={settings.fontSizeLevel}
            onChange={(v) =>
              set('fontSizeLevel', v as UserSettings['fontSizeLevel'], `글자 크기 ${v}단계.`)
            }
            className={row}
          />
          <div className={row}>
            <span className="font-bold text-ink">고대비 화면</span>
            <Checkbox
              label="켜기"
              checked={settings.highContrast}
              onChange={(e) =>
                set(
                  'highContrast',
                  e.target.checked,
                  e.target.checked ? '고대비 화면을 켰어요.' : '고대비 화면을 껐어요.',
                )
              }
            />
          </div>
        </Section>
      </div>
    </Dialog>
  )
}

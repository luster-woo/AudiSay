import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useAnnouncer } from '@/features/announcer/context'
import type { TermsDocument } from './documents'

/**
 * 약관 전문 창. 네이티브 <dialog>, 제목은 aria-labelledby 로 연결되고 열리면 포커스는 제목으로 간다.
 * 각 조는 h3 제목이라 제목 단위로 건너뛸 수 있고, 창 본문 하나만 스크롤한다(안쪽 스크롤 상자 없음).
 * 끝까지 읽지 않아도 버튼은 항상 켜져 있다. '동의하고 닫기' → 체크가 켜지고 전광판에 알린다.
 * Esc·닫기 → 체크는 그대로, 포커스는 '전문 보기' 버튼으로 돌아간다(Dialog 가 처리).
 */
export function TermsDialog({
  doc,
  open,
  onClose,
  onAgree,
}: {
  doc: TermsDocument
  open: boolean
  onClose: () => void
  /** 동의하고 닫기. 체크를 켜는 건 부모가 한다 */
  onAgree: () => void
}) {
  const { announce } = useAnnouncer()
  const shortName = doc.key === 'terms' ? '이용약관' : '개인정보 안내'

  // 창을 열면 제목으로 포커스가 가며 낭독기가 창 이름·제목을 읽는다. 같은 내용을 안내로 또 읽지 않는다 (원칙 2장)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={doc.title}
      focusTitle
      longForm
      // 닫기는 창 머리의 '닫기' 하나만 둔다 (낭독기 버튼 목록에 '닫기'가 두 번 나오지 않게).
      // 주 동작(동의)은 다른 창과 같이 노랑(accent)
      footer={
        <Button
          variant="accent"
          size="xl"
          onClick={() => {
            onAgree()
            announce(`${shortName}에 동의했어요.`)
          }}
        >
          동의하고 닫기
        </Button>
      }
    >
      {doc.clauses.map((c, i) => (
        <section key={c.title} className={i === 0 ? undefined : 'mt-6'}>
          <h3 className="text-xl font-bold">{c.title}</h3>
          {Array.isArray(c.body) ? (
            <ul className="mt-2 list-disc space-y-1 pl-7 text-lg leading-relaxed">
              {c.body.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-lg leading-relaxed">{c.body}</p>
          )}
        </section>
      ))}
    </Dialog>
  )
}

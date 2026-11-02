import { cn } from '@/components/ui/cn'

/**
 * 영상 썸네일. 제목이 바로 옆에 있으므로 장식(alt="")이다 (원칙 11장).
 * 이미지가 없으면 와이어프레임처럼 X 자 자리 표시를 그린다.
 */
export function Thumbnail({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={cn('aspect-video overflow-hidden bg-line/40', className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 160 90"
          preserveAspectRatio="none"
          className="size-full"
        >
          <path d="M0 0 L160 90 M160 0 L0 90" className="stroke-ink-muted/40" strokeWidth="0.6" />
        </svg>
      )}
    </div>
  )
}

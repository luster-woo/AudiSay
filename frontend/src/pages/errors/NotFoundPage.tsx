import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { usePageEntry } from '@/features/page/usePageEntry'

/** 없는 주소. BareLayout 안에서 렌더된다 */
export default function NotFoundPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageEntry({
    title: '없는 페이지',
    announce: '없는 페이지예요. 처음 화면으로 가는 링크가 있어요.',
    focusRef: headingRef,
  })

  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold text-ink outline-none">
        없는 페이지예요
      </h1>
      <p className="mt-4 text-lg text-ink-muted">주소가 바뀌었거나 지워진 화면이에요.</p>
      <Link
        to="/"
        className="mt-8 inline-flex min-h-touch items-center rounded-md bg-navy px-6 font-bold text-cream focus-visible:bg-navy"
      >
        처음 화면으로
      </Link>
    </div>
  )
}

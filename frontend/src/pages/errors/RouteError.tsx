import { useRef } from 'react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { usePageEntry } from '@/features/page/usePageEntry'

/**
 * 화면을 그리다 예외가 났을 때. Provider 안쪽에서 렌더되므로 announce·포커스를 쓸 수 있다.
 * 레이아웃을 대신해서 그려지므로 <main> 을 직접 가진다.
 */
export default function RouteError() {
  const error = useRouteError()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const title = notFound ? '없는 페이지예요' : '문제가 생겼어요'

  usePageEntry({
    title,
    announce: notFound
      ? '없는 페이지예요. 처음 화면으로 가는 링크가 있어요.'
      : '화면을 여는 중에 문제가 생겼어요. 다시 시도하거나 처음 화면으로 갈 수 있어요.',
    focusRef: headingRef,
  })

  if (import.meta.env.DEV) console.error(error)

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-8 py-16 outline-none">
      <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold text-ink outline-none">
        {title}
      </h1>
      <p className="mt-4 text-lg text-ink-muted">
        {notFound ? '주소가 바뀌었거나 지워진 화면이에요.' : '잠시 뒤에 다시 시도해 주세요.'}
      </p>
      <div className="mt-8 flex gap-3">
        {!notFound && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-touch rounded-md border-2 border-navy px-6 font-bold text-navy"
          >
            다시 시도
          </button>
        )}
        <Link
          to="/"
          className="inline-flex min-h-touch items-center rounded-md bg-navy px-6 font-bold text-cream focus-visible:bg-navy focus-visible:outline-yellow"
        >
          처음 화면으로
        </Link>
      </div>
    </main>
  )
}
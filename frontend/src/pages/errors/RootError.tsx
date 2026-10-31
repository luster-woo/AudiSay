/**
 Provider 자체가 깨졌을 때 쓰이므로 어떤 훅·Context 도 쓰지 않는다.
 */
export default function RootError() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-4xl font-bold text-ink">문제가 생겼어요</h1>
      <p role="alert" className="mt-4 text-lg text-ink-muted">
        AudiSay 를 여는 중에 문제가 생겼어요. 새로고침해 주세요.
      </p>
      <a
        href="/"
        className="mt-8 inline-flex min-h-touch items-center rounded-md bg-navy px-6 font-bold text-cream"
      >
        처음 화면으로
      </a>
    </main>
  )
}
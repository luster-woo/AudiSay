import { ButtonLink } from '@/components/ui/ButtonLink'

const steps = [
  { title: '둘러보기', description: '메뉴와 안내를 듣고 화면을 이동해요.' },
  { title: '영상 찾기', description: '검색어나 유튜브 주소로 영상을 찾아요.' },
  { title: '해설 들으며 보기', description: '영상과 해설을 듣고 재생을 조절해요.' },
  { title: '질문하기', description: '영상에 대해 말이나 글자로 물어봐요.' },
]

export function GettingStartedPanel() {
  return (
    <section aria-labelledby="help-start-title" className="space-y-6">
      <div>
        <h2 id="help-start-title" className="text-2xl font-bold">
          사용법을 차근차근 익혀요
        </h2>
        <p className="mt-2 text-lg">처음부터 듣거나 필요한 단계부터 시작할 수 있어요.</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-2">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="flex min-w-0 flex-col gap-3 rounded-md border-2 border-line bg-paper p-6"
          >
            <h3 className="text-xl font-bold">
              {i + 1}. {step.title}
            </h3>
            <p className="text-lg leading-relaxed">{step.description}</p>
            <ButtonLink to={`/tutorial/${i + 1}`} className="mt-auto" size="xl">
              {step.title} 사용법 듣기
            </ButtonLink>
          </li>
        ))}
      </ol>
      <ButtonLink to="/tutorial/1" variant="primary" size="xl">
        사용법 처음부터 듣기
      </ButtonLink>
    </section>
  )
}

import { useRef, useState, type FormEvent } from 'react'
import { useAnnouncer } from '@/features/announcer/context'
import { Button } from '@/components/ui/Button'
import { StatusLine } from '@/components/ui/StatusLine'

/** 2단계 연습: 검색어 적고 검색. 실제로 검색하지 않는다 */
export function SearchPractice({ done, onDone }: { done: boolean; onDone: () => void }) {
  const { announce } = useAnnouncer()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) {
      inputRef.current?.focus()
      announce('찾을 영상 제목을 적어 주세요.')
      return
    }
    onDone()
    announce(`${q}, 검색을 눌렀어요. 실제로는 해설이 있으면 바로 재생되고, 없으면 만들지 물어봐요.`)
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-3">
        <input
          ref={inputRef}
          aria-label="연습 검색어"
          placeholder="예: 김치볶음밥"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-touch min-w-0 flex-1 rounded-md border-2 border-line bg-paper px-4 text-lg"
        />
        <Button type="submit">검색</Button>
      </form>
      <StatusLine
        done={done}
        text={done ? '검색을 눌렀어요' : '아직 입력하지 않았어요'}
        className="mt-3"
      />
    </>
  )
}

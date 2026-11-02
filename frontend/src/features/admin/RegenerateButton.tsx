import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { toUserMessage } from '@/api/errors'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Notice } from '@/components/ui/Notice'
import { useAnnouncer } from '@/features/announcer/context'

export interface RegenerateButtonProps {
  videoId: number
  videoTitle: string
}

/** 전체 해설 다시 만들기. 직접 고친 문장도 새로 만들어지므로 꼭 한 번 묻는다 */
export function RegenerateButton({ videoId, videoTitle }: RegenerateButtonProps) {
  const [open, setOpen] = useState(false)
  const { announce } = useAnnouncer()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => adminApi.regenerate(videoId),
    onSuccess: () => {
      announce('해설 다시 만들기를 시작했어요. 다 만들어지면 지금 해설과 바뀌어요.')
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    },
    onError: (err) => announce(toUserMessage(err), { politeness: 'assertive' }),
  })

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        className="text-[0.8667rem]"
        loading={mutation.isPending}
        onClick={() => setOpen(true)}
      >
        전체 해설 다시 만들기
      </Button>
      <ConfirmDialog
        open={open}
        title="이 영상의 해설을 전부 다시 만들까요?"
        description={`${videoTitle} · 영상 ID ${videoId}`}
        confirmLabel="다시 만들기"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false)
          mutation.mutate()
        }}
      >
        <p>
          새 해설이 다 만들어지면 지금 해설과 바뀌어요. 그동안 사용자는 지금 해설로 계속 볼 수
          있어요.
        </p>
        <Notice title="직접 고친 문장도 새로 만들어져요" className="mt-4">
          고친 내용을 남기려면 새 해설이 나온 뒤 다시 고쳐야 해요.
        </Notice>
      </ConfirmDialog>
    </>
  )
}

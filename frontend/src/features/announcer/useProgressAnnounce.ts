import { useEffect, useRef } from 'react'
import { useAnnouncer } from './context'
import type { JobStage } from '@/api/types'

const STAGE_TEXT: Record<JobStage, string> = {
  PREPARE: '영상을 확인하고 대사를 받아 적는 중이에요',
  DESCRIBE: '장면 해설을 만드는 중이에요',
  MERGE: '해설을 합치고 다듬는 중이에요',
  TTS: '해설 음성을 만드는 중이에요',
}

export function useProgressAnnounce(stage: JobStage | null, progress: number) {
  const { announce } = useAnnouncer()
  const last = useRef<{ stage: JobStage | null; bucket: number }>({ stage: null, bucket: -1 })

  useEffect(() => {
    if (!stage) return
    const bucket = Math.floor(progress / 10)
    const stageChanged = stage !== last.current.stage
    const bucketChanged = bucket !== last.current.bucket
    if (!stageChanged && !bucketChanged) return
    last.current = { stage, bucket }
    announce(`${STAGE_TEXT[stage]}, ${progress}퍼센트.`)
  }, [stage, progress, announce])
}

import { useEffect, useRef } from 'react'
import { useAnnouncer } from './context'
import type { JobStage } from '@/api/types'

/** 단계 이름 ("~ 중이에요" / "~ 중에 멈췄어요" 앞에 붙는다) */
export const STAGE_NAME: Record<JobStage, string> = {
  PREPARE: '영상을 분석하는',
  DESCRIBE: '장면 해설을 만드는',
  MERGE: '해설을 합치고 다듬는',
  TTS: '해설 음성을 만드는',
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
    announce(`${STAGE_NAME[stage]} 중이에요, ${progress}퍼센트.`)
  }, [stage, progress, announce])
}

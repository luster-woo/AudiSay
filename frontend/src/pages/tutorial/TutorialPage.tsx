import { Navigate, useParams } from 'react-router-dom'
import { TUTORIAL_STEPS } from './steps'
import { TutorialStep } from './TutorialStep'

/** /tutorial/:step — 잘못된 단계 번호는 1단계로 보낸다 */
export default function TutorialPage() {
  const step = Number(useParams().step)
  if (!Number.isInteger(step) || step < 1 || step > TUTORIAL_STEPS.length) {
    return <Navigate to="/tutorial/1" replace />
  }
  // key 로 단계마다 상태(연습 완료 여부)를 새로 시작한다
  return <TutorialStep key={step} step={step} />
}

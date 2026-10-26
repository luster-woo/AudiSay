"""Spring → AI 서버 내부 API (API 명세서 > AI 서버 내부 API).

FE는 부르지 않고, nginx에도 연결하지 않는다. X-Internal-Token 헤더로 확인한다.
지금은 뼈대만 두고, 처리는 S15P31D101-159(질문하기 모듈)에서 채운다.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings


def require_token(x_internal_token: str = Header(default="")) -> None:
    expected = settings().ai_internal_token
    if not expected or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "내부 토큰이 맞지 않습니다"})


router = APIRouter(prefix="/internal", dependencies=[Depends(require_token)])


class IntentRequest(BaseModel):
    videoId: int | None = None
    descriptionId: int | None = None
    videoTimeMs: int | None = None
    utterance: str


class SeekRequest(BaseModel):
    descriptionId: int
    query: str


class AnswerRequest(BaseModel):
    chatLogId: int
    descriptionId: int
    videoTimeMs: int
    utterance: str
    intent: str


def _not_ready() -> HTTPException:
    return HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": "아직 구현 전입니다"})


@router.post("/stt")
async def stt() -> None:
    raise _not_ready()


@router.post("/chat/intent")
async def intent(req: IntentRequest) -> None:
    raise _not_ready()


@router.post("/chat/seek")
async def seek(req: SeekRequest) -> None:
    raise _not_ready()


@router.post("/chat/answer")
async def answer(req: AnswerRequest) -> None:
    raise _not_ready()

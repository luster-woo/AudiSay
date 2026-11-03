"""job.merge — 조각 결과를 합쳐 해설 표에 저장한다 (워커 메시지 명세 6장, 진행률 70→80).

읽는 것: jobs/{jobId}/full.json(prepare 결과, 밀리초로 정리된 전체 해설), jobs/{jobId}/prepare.json(모델명),
jobs/{jobId}/chunks/{n}.json(describe 결과, 문장 배치·검증·화면 글자). 쓰는 것: descriptions, characters, transcript_segments,
description_lines, scenes, chapters, screen_texts (Flyway V1 스키마, voice_code는 V3에서 지워져 쓰지 않음).

BE(MergePayload, 2026-10-29 develop)가 보내는 payload: {videoId, pipeline, succeededChunks[], coveredUntilMs, transcriptKey, modelName}
- succeededChunks: 0번부터 끊기지 않고 성공한 조각 번호만. 끊긴 데가 있으면 coveredUntilMs(그 조각의 끝)가 온다 → 거기까지만 저장(PARTIAL)
- modelName은 BE가 몰라서 null → prepare.json의 model을 쓴다
- STAGE_COMPLETED.result에는 descriptionId가 꼭 있어야 한다(BE는 그 값만 읽어 job.tts를 보낸다)
- videos.category는 BE가 prepare 완료 때 이미 바꾼다. 해설 공개(PUBLISHED)는 BE가 TTS 완료 때 한다. 여기서는 둘 다 하지 않는다

데모 backend/app/pipeline/store.py(save_description)와 placement.trusted_name을 asyncpg로 옮겼다.
- 인물 이름은 근거(자막·제목·이름표·호명·크레딧·시리즈 등장인물 사전)가 있을 때만 쓴다(trusted_name). 근거가 "외형",
  "대사 속 목소리"뿐이면 이름을 지우고 "이름 모르는 인물(겉모습)"로 적는다 — 틀린 이름을 시각장애인은 확인할 수 없기 때문
- 목차 키워드는 AI 없이 뽑는다(keywords.extract)
- 같은 메시지를 두 번 받으면(descriptions.job_id가 이미 있음) 완료 이벤트만 다시 보낸다

순수 변환(assemble)과 DB 쓰기(Merge)를 나눠 두어 assemble은 DB 없이 시험한다.
"""
import logging
import re
from dataclasses import dataclass, field

from app.db import Db
from app.errors import WorkerError
from app.mq.envelope import Envelope
from app.mq.worker import Events
from app.pipeline.keywords import extract
from app.storage import Storage

log = logging.getLogger(__name__)

STAGE_END_PROGRESS = 80  # 진행률 범위 MERGE 70~80
PRE_TTS_LEVEL = 2  # job.tts가 미리 음성을 만드는 상세도(1·2). 3은 사용자가 고를 때 line.tts

# 이름 근거로 인정하는 말(ai_pipeline_spec 2.1 + 데모 규칙): 이름 자막·제목·이름표, 대사 속 호명, 크레딧, 시리즈 등장인물 사전.
# 이 말이 basis에 없으면 이름을 지운다. 실제로 걸러진 예: "외형", "대사 속 목소리", "가상 홀로그램 인물"
# "대사에서 '사토 히데오의 마음을 얻어라' 언급"처럼 대사에 나온 이름도 인정한다(2026-11-03 데모 드라마 하이라이트에서 주인공 이름이 빠짐).
# 이름이 제목·대사·화면 글자에 실제로 있는지는 assemble에서 따로 확인한다
NAME_EVIDENCE = ("자막", "제목", "이름표", "호명", "부름", "부른", "대사에서", "언급", "크레딧", "크레디트", "등장인물 사전")
NAME_SOURCE_HINTS = (("SCREEN_TEXT", ("자막", "제목", "이름표", "화면")), ("DIALOGUE", ("대사", "부름", "호명", "말")))


def trusted_name(name: str | None, basis: str | None) -> str | None:
    """근거가 있는 이름만 돌려준다. 없으면 None(이름 모르는 인물로 적는다)."""
    if not name or not basis:
        return None
    return name if any(h in basis for h in NAME_EVIDENCE) else None


def name_source(basis: str | None) -> str | None:
    """characters.name_source: SCREEN_TEXT / DIALOGUE / AI."""
    if not basis:
        return None
    for code, hints in NAME_SOURCE_HINTS:
        if any(h in basis for h in hints):
            return code
    return "AI"


@dataclass
class Plan:
    """DB에 넣을 행들. 시각은 모두 밀리초."""
    category: str
    summary: str | None
    model: str | None
    dialogue_language: str | None = None  # 외국어 대사면 원래 언어. DB 칼럼이 없어 아직 저장하지 않는다(BE에 V5 요청)
    characters: list[dict] = field(default_factory=list)  # {name, appearance, nameSource}
    dialogues: list[dict] = field(default_factory=list)  # {startMs, endMs, text, speaker, original}
    lines: list[dict] = field(default_factory=list)  # {lineIndex, detailLevel, startMs, gapEndMs, importance, text, flags}
    scenes: list[dict] = field(default_factory=list)  # {sceneIndex, startMs, endMs, title, sceneDescription}
    chapters: list[dict] = field(default_factory=list)  # {chapterIndex, startMs, endMs, title, summary, keywords}
    screen_texts: list[dict] = field(default_factory=list)  # {startMs, endMs, textType, importance, fullText, sameAsDialogue}
    dropped_names: list[str] = field(default_factory=list)  # 근거가 없어 지운 이름(로그용)


def assemble(full: dict, chunks: list[dict], covered_until_ms: int | None = None, model: str | None = None) -> Plan:
    """full.json + chunks/*.json → 저장할 행(Plan). 문장·화면 글자는 조각 결과를, 장면·인물·대사·요약은 full.json을 쓴다.
    covered_until_ms가 있으면(조각 일부 실패) 그 시각까지만 저장한다."""
    duration = int(full["durationMs"])
    if covered_until_ms is not None:
        duration = min(duration, int(covered_until_ms))
    plan = Plan(category=full.get("category") or "ETC", summary=full.get("summary30s"), model=model or full.get("model"),
                dialogue_language=full.get("dialogueLanguage"))

    # 인물: 근거 있는 이름만. 누가 누구인지는 Gemini 판단 그대로.
    # 근거라고 적었어도 제목·대사·화면 글자 어디에도 없는 이름은 뺀다(시리즈 사전 이름은 사전이 근거). 2026-11-03 데모 드라마
    # 영상에 프롬프트 예시 이름 '최유리'가 상대역으로 나왔다. 제목이 없는 예전 full.json은 이 확인을 건너뛴다
    seen = None
    if full.get("title"):
        seen = re.sub(r"\s+", "", " ".join([full["title"]] + [d["text"] for d in full["dialogues"]]
                                           + [t["text"] for s in full["scenes"] for t in s.get("screenTexts", [])]))
    names: dict[str, dict] = {}
    dropped: set[str] = set()
    for s in full["scenes"]:
        for p in s.get("people", []):
            name = trusted_name(p.get("name"), p.get("basis"))
            if name and seen is not None and "사전" not in (p.get("basis") or "") and re.sub(r"\s+", "", name) not in seen:
                name = None
            if p.get("name") and not name:
                dropped.add(p["name"])
            if name and name not in names:
                names[name] = {"name": name, "appearance": p.get("appearance"), "nameSource": name_source(p.get("basis"))}
    plan.characters = list(names.values())
    plan.dropped_names = sorted(dropped - set(names))

    plan.dialogues = sorted(({"startMs": min(int(d["startMs"]), duration), "endMs": min(int(d["endMs"]), duration),
                              "speaker": (d.get("speaker") or "").split(" (")[0].strip() or None, "text": d["text"],
                              "original": d.get("original")}
                             for d in full["dialogues"] if int(d["startMs"]) < duration), key=lambda d: d["startMs"])
    for d in plan.dialogues:
        d["endMs"] = max(d["endMs"], d["startMs"])

    # 문장: 조각마다 배치가 끝난 것을 모아 시각 순으로 번호를 매긴다
    lines = []
    for c in sorted(chunks, key=lambda c: c["chunkIndex"]):
        for x in c["lines"]:
            text = x["text"].strip()
            if text and int(x["startMs"]) <= duration:
                lines.append({"detailLevel": int(x["detailLevel"]), "startMs": int(x["startMs"]), "gapEndMs": x.get("gapEndMs"),
                              "importance": int(x.get("importance") or 4 - int(x["detailLevel"])), "text": text,
                              "flags": list(x.get("flags") or []) + (["UNSUPPORTED_NAME"] if any(n in text for n in plan.dropped_names) else [])})
    lines.sort(key=lambda x: (x["startMs"], x["detailLevel"]))
    for i, x in enumerate(lines, 1):
        x["lineIndex"] = i
    plan.lines = lines

    # 장면·목차: 겹치지 않게(scenes의 EXCLUDE 제약) 앞 장면 끝 이후부터
    prev_end, n = 0, 0
    for s in sorted(full["scenes"], key=lambda s: s["startMs"]):
        a, b = max(int(s["startMs"]), prev_end), min(int(s["endMs"]), duration)
        if b <= a:
            continue
        n += 1
        prev_end = b
        in_scene = [x for x in lines if a <= x["startMs"] < b]
        people = []
        for p in s.get("people", []):
            name = trusted_name(p.get("name"), p.get("basis"))
            people.append(f"{name}({p['appearance']})" if name else f"이름 모르는 인물({p['appearance']})")
        desc = " ".join(x["text"] for x in in_scene)
        if people:
            desc = (desc + " " if desc else "") + "등장: " + ", ".join(people)
        title = (s.get("title") or "")[:100]
        plan.scenes.append({"sceneIndex": n, "startMs": a, "endMs": b, "title": title, "sceneDescription": desc or title})
        plan.chapters.append({"chapterIndex": n, "startMs": a, "endMs": b, "title": title,
                              "summary": " ".join(x["text"] for x in in_scene if x["detailLevel"] <= 2) or None,
                              "keywords": extract(title, [x["text"] for x in in_scene])})

    # 화면 글자: describe가 이미 '해설 문장에 들어간 글자'를 뺐다. 그대로 모은다
    for c in chunks:
        for t in c.get("screenTexts", []):
            if int(t["startMs"]) >= duration:
                continue
            plan.screen_texts.append({"startMs": int(t["startMs"]), "endMs": max(int(t["endMs"]), int(t["startMs"])),
                                      "textType": t.get("textType") or "OTHER", "importance": t.get("importance") or "MEDIUM",
                                      "fullText": t["fullText"], "sameAsDialogue": bool(t.get("sameAsDialogue"))})
    plan.screen_texts.sort(key=lambda t: t["startMs"])
    return plan


class Merge:
    def __init__(self, storage: Storage, db: Db):
        self.storage, self.db = storage, db

    async def __call__(self, env: Envelope, events: Events) -> None:
        p, job_id = env.payload, env.jobId
        pool = self.db.pool
        if pool is None:
            raise WorkerError("UNKNOWN", "DB에 연결되어 있지 않아 해설을 저장할 수 없습니다")
        video_id = p.get("videoId")
        if video_id is None:
            raise WorkerError("UNKNOWN", "payload.videoId가 없습니다", retryable=False)

        existing = await pool.fetchrow("SELECT id FROM descriptions WHERE job_id = $1", job_id)
        if existing:  # 중복 메시지
            await events.completed(await self._result(pool, existing["id"]), progress=STAGE_END_PROGRESS)
            return

        full_key = f"jobs/{job_id}/full.json"
        if not await self.storage.exists(full_key):
            raise WorkerError("UNKNOWN", f"{full_key}가 없습니다(job.prepare 결과 없음)")
        await events.started()
        full = await self.storage.get_json(full_key)
        chunks = await self._load_chunks(job_id, p)
        covered = p.get("coveredUntilMs")
        plan = assemble(full, chunks, int(covered) if covered is not None else None,
                        p.get("modelName") or await self._model(job_id))
        if covered is not None:
            log.info("조각 일부 실패 job=%s: %sms까지만 저장(PARTIAL)", job_id, covered)
        for x in plan.lines:
            if x["flags"]:
                log.info("검증 표시 job=%s %s [%s] %s", job_id, x["flags"], x["startMs"], x["text"])
        if plan.dropped_names:
            log.info("근거 없는 이름 제외 job=%s: %s", job_id, plan.dropped_names)

        desc_id = await self._save(pool, int(video_id), job_id, plan)
        log.info("merge 완료 job=%s description=%s 문장 %s개 장면 %s개 인물 %s명", job_id, desc_id, len(plan.lines),
                 len(plan.scenes), len(plan.characters))
        await events.completed(await self._result(pool, desc_id), progress=STAGE_END_PROGRESS)

    async def _prepare(self, job_id: int) -> dict:
        prep_key = f"jobs/{job_id}/prepare.json"
        if not await self.storage.exists(prep_key):
            raise WorkerError("UNKNOWN", f"{prep_key}가 없습니다(job.prepare 결과 없음)")
        return await self.storage.get_json(prep_key)

    async def _model(self, job_id: int) -> str | None:
        """BE는 모델을 몰라 modelName을 null로 보낸다 → prepare.json의 model."""
        return (await self._prepare(job_id)).get("model")

    async def _load_chunks(self, job_id: int, p: dict) -> list[dict]:
        """payload.succeededChunks(0번부터 연속 성공한 조각)만 읽는다. 없으면(수동 테스트) prepare.json의 조각 전부."""
        if p.get("succeededChunks") is not None:
            indexes = [int(i) for i in p["succeededChunks"]]
            if not indexes:
                raise WorkerError("UNKNOWN", "succeededChunks가 비어 있습니다(성공한 조각 없음)", retryable=False)
        else:
            indexes = [int(c["chunkIndex"]) for c in (await self._prepare(job_id))["chunks"]]
        chunks = []
        for i in indexes:
            key = f"jobs/{job_id}/chunks/{i}.json"
            if not await self.storage.exists(key):
                raise WorkerError("UNKNOWN", f"{key}가 없습니다(job.describe 결과 없음)")
            chunks.append(await self.storage.get_json(key))
        return chunks

    @staticmethod
    async def _save(pool, video_id: int, job_id: int, plan: Plan) -> int:
        async with pool.acquire() as con, con.transaction():
            # 이전 해설 ARCHIVED·새 해설 PUBLISHED·videos.category는 BE(descriptionService.publish, onPrepareCompleted)가 한다
            desc_id = await con.fetchval(
                "INSERT INTO descriptions (video_id, job_id, status, summary_text, model_name)"
                " VALUES ($1, $2, 'GENERATING', $3, $4) RETURNING id", video_id, job_id, plan.summary, plan.model)

            char_ids: dict[str, int] = {}
            for c in plan.characters:
                char_ids[c["name"]] = await con.fetchval(
                    "INSERT INTO characters (description_id, name, aliases, appearance, name_source)"
                    " VALUES ($1, $2, $3, $4, $5) RETURNING id", desc_id, c["name"], [], c["appearance"], c["nameSource"])
            await con.executemany(
                "INSERT INTO transcript_segments (description_id, start_ms, end_ms, text, character_id) VALUES ($1, $2, $3, $4, $5)",
                [(desc_id, d["startMs"], d["endMs"], d["text"], char_ids.get(d["speaker"] or "")) for d in plan.dialogues])
            # 외국어 대사 원문(d["original"])은 jobs/{jobId}/full.json에만 있다. V5(original_text) 생기면 여기서 같이 넣는다
            await con.executemany(
                "INSERT INTO description_lines (description_id, line_index, detail_level, start_ms, gap_end_ms, importance, text)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [(desc_id, x["lineIndex"], x["detailLevel"], x["startMs"], x["gapEndMs"], x["importance"], x["text"])
                 for x in plan.lines])
            await con.executemany(
                "INSERT INTO scenes (description_id, scene_index, start_ms, end_ms, title, scene_description)"
                " VALUES ($1, $2, $3, $4, $5, $6)",
                [(desc_id, s["sceneIndex"], s["startMs"], s["endMs"], s["title"], s["sceneDescription"]) for s in plan.scenes])
            await con.executemany(
                "INSERT INTO chapters (description_id, chapter_index, start_ms, end_ms, title, summary, keywords)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [(desc_id, c["chapterIndex"], c["startMs"], c["endMs"], c["title"], c["summary"], c["keywords"])
                 for c in plan.chapters])
            await con.executemany(
                "INSERT INTO screen_texts (description_id, start_ms, end_ms, text_type, full_text, importance, same_as_dialogue)"
                " VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [(desc_id, t["startMs"], t["endMs"], t["textType"], t["fullText"], t["importance"], t["sameAsDialogue"])
                 for t in plan.screen_texts])
        return desc_id

    @staticmethod
    async def _result(pool, desc_id: int) -> dict:
        """STAGE_COMPLETED.result — BE(MergeResult)는 descriptionId만 읽어 job.tts를 보낸다. 나머지는 로그·확인용."""
        r = await pool.fetchrow(
            "SELECT (SELECT COUNT(*) FROM description_lines WHERE description_id = $1) AS lines,"
            " (SELECT COUNT(*) FROM description_lines WHERE description_id = $1 AND detail_level <= $2) AS tts_lines,"
            " (SELECT COUNT(*) FROM scenes WHERE description_id = $1) AS scenes,"
            " (SELECT COUNT(*) FROM characters WHERE description_id = $1) AS characters", desc_id, PRE_TTS_LEVEL)
        return {"descriptionId": desc_id, "lines": r["lines"], "ttsLines": r["tts_lines"], "scenes": r["scenes"],
                "characters": r["characters"]}

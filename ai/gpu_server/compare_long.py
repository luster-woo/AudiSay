"""compare_models.py의 긴 작업판: 영상 전체 줄거리(/story), 영상 통째 해설(/describe_video), 번역(/translate)을 두 vLLM에 똑같이 시킨다.
server.py가 vLLM에 보내는 요청을 그대로 흉내 낸다(서버 코드는 실행하지 않고 프롬프트 글만 읽음). 사진 격자에 PIL·cv2가 필요해
gpu_server 가상환경으로 돌린다:
    ~/gpu_server/.venv/bin/python compare_long.py \
        --a http://127.0.0.1:8201/v1=Qwen/Qwen3-VL-32B-Instruct-FP8 --b http://127.0.0.1:8202/v1=Qwen/Qwen3.8-27B-FP8 \
        --video ~/vllm_exp/media/cam540.mp4=Caminandes=~/vllm_exp/eval/cam540_req.json \
        --video ~/vllm_exp/media/ivana640.mp4=Ivana=~/vllm_exp/eval/ivana640_req.json \
        --translate ~/gpu_server/experiments/mango_en.json
--video의 _req.json은 노트북에서 app.pipeline.video의 build_video_prompt·video_schema로 만든 {prompt, schema}(지금 서비스와 같은 글).
영상 파일은 두 vLLM의 --allowed-local-media-path(~/vllm_exp/media) 아래에 있어야 한다.
결과: long_<시각>.jsonl + 화면 요약 표
"""
import argparse
import base64
import io
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from compare_models import call, checks, json_ok, load_prompts

HANZI = re.compile("[一-鿿㐀-䶿぀-ヿ]")  # server.py와 같은 범위(한자 + 가나)


def story_grids(mp4: Path, every_sec: float = 3.0, per: int = 9, cell=(384, 216)) -> list[str]:
    """server.py의 _grids와 같은 3×3 격자(칸 왼쪽 위 '41s'), 영상에서 every_sec초마다 한 장, 최대 8장."""
    import cv2
    from PIL import Image, ImageDraw
    v = cv2.VideoCapture(str(mp4))
    dur = v.get(cv2.CAP_PROP_FRAME_COUNT) / v.get(cv2.CAP_PROP_FPS)
    frames, t = [], 0.0
    while t < dur and len(frames) < per * 8:
        v.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, f = v.read()
        if ok:
            frames.append((int(t), Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))))
        t += every_sec
    out = []
    for k in range(0, len(frames), per):
        part = frames[k:k + per]
        g = Image.new("RGB", (cell[0] * 3, cell[1] * ((len(part) + 2) // 3)), "black")
        d = ImageDraw.Draw(g)
        for j, (sec, im) in enumerate(part):
            x, y = cell[0] * (j % 3), cell[1] * (j // 3)
            g.paste(im.resize(cell), (x, y))
            label = f"{sec}s"
            d.rectangle((x, y, x + 12 * len(label) + 8, y + 24), fill="black")
            d.text((x + 4, y + 4), label, fill="yellow")
        buf = io.BytesIO()
        g.save(buf, "JPEG", quality=85)
        out.append(base64.b64encode(buf.getvalue()).decode())
    return out[:8]


def video_call(base, model, mp4: Path, req: dict) -> dict:
    """server.py /describe_video와 같은 요청(temperature 0.2, json_schema, 최대 10,000토큰). 깨지면 반복 벌점 1.1로 한 번 더."""
    pre = [{"type": "video_url", "video_url": {"url": mp4.as_uri()}}]
    extra = {"temperature": 0.2,
             "response_format": {"type": "json_schema", "json_schema": {"name": "Narration", "schema": req["schema"]}}}
    t0 = time.time()
    r = call(base, model, None, req["prompt"], max_tokens=10000, extra=extra, pre=pre)
    tries = 1
    if r["ok"] and json_ok(r["text"]) is None:
        r = call(base, model, None, req["prompt"], max_tokens=10000, extra={**extra, "repetition_penalty": 1.1}, pre=pre)
        tries = 2
    j = json_ok(r["text"]) if r["ok"] else None
    return {**r, "sec": round(time.time() - t0, 2), "tries": tries, "json": j is not None,
            "scenes": len((j or {}).get("scenes", [])), "lines": count_lines(j)}


def count_lines(x) -> int:
    """해설 문장 수: windows[].lines_1·lines_2·lines_3(상세도별) 목록의 항목을 모두 센다."""
    if isinstance(x, dict):
        return sum(len(v) if k.startswith("lines") and isinstance(v, list) else count_lines(v) for k, v in x.items())
    if isinstance(x, list):
        return sum(count_lines(v) for v in x)
    return 0


def translate_one(base, model, P, title, texts, k) -> dict:
    """server.py _translate_part(한 조각 + 앞뒤 2개 맥락, 반복 벌점 1.1). 틀리면 RETRY_HINT로 한 번 더."""
    before, after = texts[max(0, k - 2):k], texts[k + 1:k + 3]
    ctx = "\n".join([f"(앞) {t}" for t in before] + [f"(뒤) {t}" for t in after]) or "(없음)"
    out = None
    t0 = time.time()
    for retry in (False, True):
        user = (f"영상 제목: {title}\n원래 언어: en\n앞뒤 맥락(번역하지 않음):\n{ctx}\n번역할 조각(1개):\n1. {texts[k]}"
                + (P["RETRY_HINT"] if retry else ""))
        r = call(base, model, P["TRANSLATE_SYSTEM"], user, max_tokens=140, extra={"repetition_penalty": 1.1})
        j = json_ok(r["text"]) or {}
        ko = [re.sub(r"^\s*\d+\s*[.)]\s*", "", str(x)).strip() for x in j.get("ko", [])] if isinstance(j.get("ko"), list) else []
        if len(ko) == 1 and ko[0] and not HANZI.search(ko[0]):
            out = ko[0]
            break
    return {**r, "sec": round(time.time() - t0, 2), "k": k, "en": texts[k], "ko": out, "retried": retry}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--server", default=str(Path(__file__).with_name("server.py")))
    ap.add_argument("--video", action="append", default=[], help="mp4=제목=req.json")
    ap.add_argument("--translate", help="[{en: ...}] json")
    a = ap.parse_args()
    P = load_prompts(Path(a.server))
    if {"STORY_SYSTEM", "TRANSLATE_SYSTEM", "RETRY_HINT"} - P.keys():
        sys.exit("server.py에서 프롬프트를 못 찾음")
    videos = []
    for v in a.video:
        mp4, title, req = v.split("=", 2)
        videos.append((Path(mp4).expanduser(), title, json.loads(Path(req).expanduser().read_text(encoding="utf-8"))))
    grids = {mp4: story_grids(mp4) for mp4, _, _ in videos}
    texts = [x["en"] for x in json.loads(Path(a.translate).expanduser().read_text(encoding="utf-8"))] if a.translate else []

    out_path = Path(f"long_{time.strftime('%Y%m%d_%H%M%S')}.jsonl")
    rows = {}
    with out_path.open("w", encoding="utf-8") as out:
        def log(side, model, task, r, **extra):
            out.write(json.dumps({"side": side, "model": model, "task": task, **r, **checks(r), **extra}, ensure_ascii=False) + "\n")
            out.flush()

        for side, spec in (("A", a.a), ("B", a.b)):
            base, model = spec.split("=", 1)
            base = base.rstrip("/")
            s = rows.setdefault(side, {"model": model})
            print(f"== {side}: {model}", flush=True)
            for mp4, title, _ in videos:  # 줄거리(/story)
                user = (f"영상 제목: {title}\n\n사진 격자 {len(grids[mp4])}장(칸마다 초 표시)\n소리 사건:\n(없음)\n대사:\n(없음)")
                r = call(base, model, P["STORY_SYSTEM"], user, grids[mp4], max_tokens=1500)
                j = json_ok(r["text"])
                log(side, model, "story", r, video=mp4.name, json=j is not None)
                s[f"story {mp4.stem}"] = (f"{r['sec']}초, {r.get('out_tokens')}토큰, 사건 {len((j or {}).get('events', []))}개"
                                          + ("" if j else ", JSON 깨짐"))
            for mp4, title, req in videos:  # 영상 통째 해설, 하나씩
                r = video_call(base, model, mp4, req)
                log(side, model, "video", r, video=mp4.name)
                s[f"video {mp4.stem}"] = (f"{r['sec']}초, 입력 {r.get('in_tokens')}·출력 {r.get('out_tokens')}토큰, "
                                          f"장면 {r['scenes']}·문장 {r['lines']}" + ("" if r["json"] else ", JSON 깨짐")
                                          + (" (재시도)" if r["tries"] > 1 else "") + ("" if r["ok"] else f", 실패 {r.get('error')}"))
            if len(videos) >= 2:  # 영상 두 편 동시
                t0 = time.time()
                with ThreadPoolExecutor(len(videos)) as ex:
                    rs = list(ex.map(lambda v: video_call(base, model, v[0], v[2]), videos))
                for (mp4, _, _), r in zip(videos, rs):
                    log(side, model, "video_parallel", r, video=mp4.name)
                s["video 동시"] = f"{round(time.time() - t0, 1)}초(각 {', '.join(str(r['sec']) for r in rs)}), JSON {sum(r['json'] for r in rs)}/{len(rs)}"
            if texts:  # 번역: 조각마다 동시 8개(server.py VLLM_PARALLEL)
                t0 = time.time()
                with ThreadPoolExecutor(8) as ex:
                    rs = list(ex.map(lambda k: translate_one(base, model, P, "몰디브 망고 커리 만들기", texts, k), range(len(texts))))
                for r in rs:
                    log(side, model, "translate", r)
                s["번역"] = (f"{round(time.time() - t0, 1)}초, 성공 {sum(r['ko'] is not None for r in rs)}/{len(rs)}, "
                            f"재시도 {sum(r['retried'] for r in rs)}")
                s["_ko"] = [r["ko"] for r in rs]

    keys = [k for k in rows["A"] if not k.startswith("_") and k != "model"]
    print("\n| 항목 | A | B |\n|---|---|---|")
    print(f"| 모델 | {rows['A']['model']} | {rows['B']['model']} |")
    for k in keys:
        print(f"| {k} | {rows['A'].get(k)} | {rows['B'].get(k)} |")
    if texts:
        print("\n번역 나란히")
        for i, en in enumerate(texts):
            print(f"[{i + 1}] {en[:80]}\n  A: {rows['A']['_ko'][i]}\n  B: {rows['B']['_ko'][i]}")
    print(f"\n자세한 기록: {out_path}")


if __name__ == "__main__":
    main()

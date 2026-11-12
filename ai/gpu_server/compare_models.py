"""vLLM 두 개(예: 지금 쓰는 32B FP8 vs Qwen3.5-35B-A3B)에 같은 일을 시켜 속도·형식·한국어를 나란히 본다.

H200에서 실행(표준 라이브러리만 씀, 서버 코드는 실행하지 않고 server.py에서 프롬프트 글만 읽어 온다):
    python3 compare_models.py \
        --a http://127.0.0.1:8201/v1=Qwen/Qwen3-VL-32B-Instruct-FP8 \
        --b http://127.0.0.1:8202/v1=Qwen/Qwen3.5-35B-A3B-FP8 \
        --images ~/vllm_exp/media/mango_frames --parallel 1,4,8

보는 것
- 발화 분석(INTENT_SYSTEM): JSON이 맞는지, 정답 의도와 같은지
- 질문 답변(ANSWER_SYSTEM): 걸린 시간·답(사람이 읽고 판단)
- 장면 해설(DESCRIBE_SYSTEM, --images가 있을 때): 사진 8장까지, 걸린 시간·JSON 여부
- 동시 처리(--parallel): 장면 해설을 N개 동시에 보내 초당 토큰
- 모든 답: 한자(중국어 글자) 수, <think> 섞임 여부
Qwen3.5 계열은 기본으로 생각 모드가 켜져 있어 chat_template_kwargs로 끈다(Qwen3-VL은 이 값을 무시한다).
결과: compare_<시각>.jsonl(한 줄 = 요청 하나) + 화면에 요약 표
"""
import argparse
import ast
import base64
import json
import re
import statistics
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HAN = re.compile(r"[一-鿿]")

INTENT_CASES = [  # (말, 정답 의도)
    ("지금 누가 울고 있어?", "QUESTION"),
    ("이 장면 설명해 줘", "SCENE_NOW"),
    ("아까 춤추던 데로 다시 가 줘", "SEEK_SCENE"),
    ("2분 15초로", "SEEK_TIME"),
    ("좀 천천히 말해 줘", "SETTING"),
    ("잠깐 멈춰", "ACTION"),
    ("오늘 저녁 뭐 먹지", "UNKNOWN"),
    ("저 강아지 이름이 뭐였더라", "QUESTION"),
]

ANSWER_CONTEXT = [
    {"time": "00:12", "text": "노란 앞치마를 두른 남자가 망고를 깍둑썰기한다."},
    {"time": "00:31", "text": "냄비에 카레 가루와 코코넛 밀크를 붓고 젓는다."},
    {"time": "00:55", "text": "남자가 완성된 망고 커리를 맛보고 엄지를 든다."},
]
ANSWER_QUESTIONS = ["지금 뭐 넣었어?", "앞치마 무슨 색이야?", "이 사람 이름이 뭐야?", "맛있대?"]


def load_prompts(server_py: Path) -> dict:
    """server.py를 실행하지 않고 프롬프트 상수만 꺼낸다(f-string은 앞서 읽은 상수로 채운다)."""
    want = {"UNANSWERABLE", "INTENT_SYSTEM", "ANSWER_SYSTEM", "DESCRIBE_SYSTEM"}
    ns: dict = {}
    for node in ast.parse(server_py.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in want:
                try:
                    ns[name] = eval(compile(ast.Expression(node.value), name, "eval"), {}, dict(ns))  # noqa: S307 — 우리 파일의 문자열 상수
                except Exception as e:  # noqa: BLE001
                    print(f"{name} 못 읽음: {e}", file=sys.stderr)
    return ns


def call(base: str, model: str, system: str, user: str, images: list[str] | None = None, max_tokens: int = 512) -> dict:
    content = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b}} for b in images or []]
    body = {"model": model, "temperature": 0, "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": False},
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": content + [{"type": "text", "text": user}]}]}
    req = urllib.request.Request(base + "/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            j = json.load(r)
        text = j["choices"][0]["message"]["content"] or ""
        usage = j.get("usage") or {}
        return {"ok": True, "sec": round(time.time() - t0, 3), "text": text,
                "out_tokens": usage.get("completion_tokens"), "in_tokens": usage.get("prompt_tokens"),
                "finish": j["choices"][0].get("finish_reason")}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "sec": round(time.time() - t0, 3), "text": "", "error": f"{type(e).__name__}: {str(e)[:200]}"}


def json_ok(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def checks(r: dict) -> dict:
    t = r.get("text", "")
    return {"han": len(HAN.findall(t)), "think": "<think>" in t or "</think>" in t}


def run_side(label: str, base: str, model: str, P: dict, images: list[str], parallel: list[int], out) -> dict:
    s = {"label": label, "model": model}

    def log(task: str, r: dict, **extra):
        rec = {"side": label, "model": model, "task": task, **r, **checks(r), **extra}
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
        out.flush()
        return rec

    call(base, model, "안녕", "안녕", max_tokens=4)  # 첫 요청 준비 시간 빼기

    recs = []
    for utt, gold in INTENT_CASES:
        r = call(base, model, P["INTENT_SYSTEM"], "말: " + utt, max_tokens=80)
        j = json_ok(r["text"])
        recs.append(log("intent", r, utterance=utt, gold=gold, pred=(j or {}).get("intent"), json=j is not None))
    s["intent_correct"] = f"{sum(x['pred'] == x['gold'] for x in recs)}/{len(recs)}"
    s["intent_json"] = f"{sum(x['json'] for x in recs)}/{len(recs)}"
    s["intent_sec_med"] = statistics.median(x["sec"] for x in recs)

    recs = []
    ctx = json.dumps(ANSWER_CONTEXT, ensure_ascii=False)
    for q in ANSWER_QUESTIONS:
        r = call(base, model, P["ANSWER_SYSTEM"], f"해설 자료:\n{ctx}\n\n질문: {q}", max_tokens=200)
        recs.append(log("answer", r, question=q))
    s["answer_sec_med"] = statistics.median(x["sec"] for x in recs)
    s["answers"] = [x["text"] for x in recs]

    if images:
        user = "이 장면의 사진입니다. 대사·화면 글자·소리 정보는 없습니다. 지시한 형식대로 해설하세요."
        r = log("describe", call(base, model, P["DESCRIBE_SYSTEM"], user, images, max_tokens=1024))
        s["describe_sec"] = r["sec"]
        s["describe_json"] = json_ok(r["text"]) is not None
        s["describe_text"] = r["text"][:400]
        for n in parallel:
            t0 = time.time()
            with ThreadPoolExecutor(n) as ex:
                rs = list(ex.map(lambda _: call(base, model, P["DESCRIBE_SYSTEM"], user, images, max_tokens=1024), range(n)))
            wall = time.time() - t0
            toks = sum(x.get("out_tokens") or 0 for x in rs)
            for x in rs:
                log(f"parallel{n}", x)
            s[f"par{n}_wall"] = round(wall, 2)
            s[f"par{n}_tok_s"] = round(toks / wall, 1) if wall else None
            s[f"par{n}_fail"] = sum(not x["ok"] for x in rs)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="URL=모델이름 (예: http://127.0.0.1:8201/v1=Qwen/Qwen3-VL-32B-Instruct-FP8)")
    ap.add_argument("--b", required=True)
    ap.add_argument("--server", default=str(Path(__file__).with_name("server.py")))
    ap.add_argument("--images", help="장면 사진(jpg) 폴더, 이름순 앞 8장")
    ap.add_argument("--parallel", default="1,4,8")
    a = ap.parse_args()

    P = load_prompts(Path(a.server))
    missing = {"INTENT_SYSTEM", "ANSWER_SYSTEM", "DESCRIBE_SYSTEM"} - P.keys()
    if missing:
        sys.exit(f"server.py에서 못 찾음: {missing}")
    images = []
    if a.images:
        images = [base64.b64encode(p.read_bytes()).decode() for p in sorted(Path(a.images).expanduser().glob("*.jpg"))[:8]]
    parallel = [int(x) for x in a.parallel.split(",") if x]

    out_path = Path(f"compare_{time.strftime('%Y%m%d_%H%M%S')}.jsonl")
    sums = []
    with out_path.open("w", encoding="utf-8") as out:
        for label, spec in (("A", a.a), ("B", a.b)):
            base, model = spec.split("=", 1)
            print(f"== {label}: {model}", flush=True)
            sums.append(run_side(label, base.rstrip("/"), model, P, images, parallel, out))

    han = {}
    think = {}
    for line in out_path.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        han[r["side"]] = han.get(r["side"], 0) + r["han"]
        think[r["side"]] = think.get(r["side"], 0) + int(r["think"])
    keys = [k for k in sums[0] if k not in ("label", "answers", "describe_text")]
    print("\n| 항목 | A | B |\n|---|---|---|")
    for k in keys:
        print(f"| {k} | {sums[0].get(k)} | {sums[1].get(k)} |")
    print(f"| 한자 글자 수(전체) | {han.get('A', 0)} | {han.get('B', 0)} |")
    print(f"| <think> 섞인 답 | {think.get('A', 0)} | {think.get('B', 0)} |")
    for s in sums:
        print(f"\n[{s['label']}] 질문 답변")
        for q, t in zip(ANSWER_QUESTIONS, s["answers"]):
            print(f"  {q} → {t}")
        if "describe_text" in s:
            print(f"[{s['label']}] 장면 해설 앞부분: {s['describe_text']}")
    print(f"\n자세한 기록: {out_path}")


if __name__ == "__main__":
    main()

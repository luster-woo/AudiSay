"""Supertonic 한 문장을 '정해진 크기' 세션으로 돌린다(서버 버전 12).

문제(2026-10-30 H200 실측): ONNX Runtime CUDA는 합성곱(Conv)마다 cuDNN 계산 방법을 찾는데(EXHAUSTIVE), 세션마다
'가장 최근 입력 크기 하나'만 기억한다. 그래서 같은 문장 반복은 0.04초인데, 길이가 다른 새 문장은 매번 1.6초
(노트북 RTX 4050도 1.5~2.6초). 질문 답·안내처럼 늘 새 문장이면 매번 1.6초다.
  - 계산 방법을 찾지 않는 설정(HEURISTIC)은 늘 0.24초, DEFAULT는 0.7초(느린 계산 방법을 고름)
해결: 입력 길이를 몇 가지 크기로 채우고(빈칸은 mask로 가림), 크기마다 세션을 따로 둔다. 각 세션은 늘 같은 크기만
보므로 처음 한 번 찾은 계산 방법을 계속 쓴다 → 새 문장도 약 0.04초. 빈칸 채우기는 Supertonic이 여러 문장을
한 번에 만들 때 짧은 문장에 쓰는 방식과 같아 소리는 같다(끝 빈칸 소리는 잘라 냄).
비용: 세션 53개(글자 4종 × 소리 9종 + α), GPU 메모리 약 10GB(H200 143GB 중), 켤 때 미리 만들기 약 1~2분(뒤에서).
"""
import threading

import numpy as np
import onnxruntime as ort

TEXT_STEP, TEXT_MAX = 64, 256  # 글자 열(한국어 한 덩어리 120자 ≈ 250칸) → 64·128·192·256
LATENT_STEP, LATENT_MAX = 32, 288  # 소리 잠재 열(1초 ≈ 14.4칸 = 44.1kHz ÷ 3072) → 32~288(약 20초까지)


def _up(n: int, step: int) -> int:
    return max(step, ((n + step - 1) // step) * step)


class Bucketed:
    def __init__(self, engine, providers: list):
        self.e = engine  # supertonic TTS(...).model
        self.providers = providers
        self.paths = {k: getattr(engine, f"{k}_ort")._model_path for k in ("dp", "text_enc", "vector_est", "vocoder")}
        self._sessions: dict = {}
        self._make = threading.Lock()

    def _sess(self, kind: str, key) -> ort.InferenceSession:
        s = self._sessions.get((kind, key))
        if s is None:
            with self._make:
                s = self._sessions.get((kind, key))
                if s is None:
                    s = ort.InferenceSession(self.paths[kind], providers=self.providers)
                    self._sessions[(kind, key)] = s
        return s

    def fits(self, text: str, lang: str = "ko") -> bool:
        ids, _ = self.e.text_processor([text], lang)
        return ids.shape[1] <= TEXT_MAX

    def synth(self, text: str, style, total_step: int = 5, speed: float = 1.05, lang: str = "ko") -> tuple[np.ndarray, float] | None:
        """→ (wav 1차원 float32, 길이 초). 크기를 넘으면 None(부른 쪽이 원래 방식으로 만든다)."""
        e = self.e
        text_ids, text_mask = e.text_processor([text], lang)
        n = text_ids.shape[1]
        if n > TEXT_MAX:
            return None
        tb = _up(n, TEXT_STEP)
        text_ids = np.pad(text_ids, ((0, 0), (0, tb - n)))
        text_mask = np.pad(text_mask, ((0, 0), (0, 0), (0, tb - n)))

        dur, *_ = self._sess("dp", tb).run(None, {"text_ids": text_ids, "style_dp": style.dp, "text_mask": text_mask})
        dur = dur / speed
        chunk = e.base_chunk_size * e.chunk_compress_factor
        lat_len = (int(dur[0] * e.sample_rate) + chunk - 1) // chunk
        if lat_len > LATENT_MAX:
            return None
        lb = _up(lat_len, LATENT_STEP)
        text_emb, *_ = self._sess("text_enc", tb).run(None, {"text_ids": text_ids, "style_ttl": style.ttl, "text_mask": text_mask})

        latent_mask = (np.arange(lb) < lat_len).astype(np.float32).reshape(1, 1, lb)
        xt = np.random.randn(1, e.ldim * e.chunk_compress_factor, lb).astype(np.float32) * latent_mask
        total = np.array([total_step], dtype=np.float32)
        vec = self._sess("vector_est", (tb, lb))
        for step in range(total_step):
            xt, *_ = vec.run(None, {
                "noisy_latent": xt, "text_emb": text_emb, "style_ttl": style.ttl, "text_mask": text_mask,
                "latent_mask": latent_mask, "current_step": np.array([step], dtype=np.float32), "total_step": total,
            })
        wav, *_ = self._sess("vocoder", lb).run(None, {"latent": xt * latent_mask})
        return wav.reshape(-1)[: lat_len * chunk], float(dur[0])

    def warm(self, style) -> int:
        """모든 크기 세션을 만들고 한 번씩 돌린다(계산 방법 찾기를 미리). 켤 때 뒤에서 부른다. → 세션 수."""
        e = self.e
        ids, _ = e.text_processor(["가나다라마바사아자차카타파하 " * 30], "ko")
        dim = e.ldim * e.chunk_compress_factor
        z = np.array([0], dtype=np.float32)
        total = np.array([5], dtype=np.float32)
        for lb in range(LATENT_STEP, LATENT_MAX + 1, LATENT_STEP):
            self._sess("vocoder", lb).run(None, {"latent": np.zeros((1, dim, lb), dtype=np.float32)})
        for tb in range(TEXT_STEP, TEXT_MAX + 1, TEXT_STEP):
            t_ids, t_mask = np.ascontiguousarray(ids[:, :tb]), np.ones((1, 1, tb), dtype=np.float32)
            self._sess("dp", tb).run(None, {"text_ids": t_ids, "style_dp": style.dp, "text_mask": t_mask})
            emb, *_ = self._sess("text_enc", tb).run(None, {"text_ids": t_ids, "style_ttl": style.ttl, "text_mask": t_mask})
            for lb in range(LATENT_STEP, LATENT_MAX + 1, LATENT_STEP):
                self._sess("vector_est", (tb, lb)).run(None, {
                    "noisy_latent": np.zeros((1, dim, lb), dtype=np.float32), "text_emb": emb, "style_ttl": style.ttl,
                    "text_mask": t_mask, "latent_mask": np.ones((1, 1, lb), dtype=np.float32), "current_step": z, "total_step": total,
                })
        return len(self._sessions)

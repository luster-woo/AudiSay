#!/usr/bin/env bash
# 시험용 모델(기본 Qwen3.8-27B FP8)을 32B(8201)와 나란히 띄워 compare_models.py로 비교한다. 서비스에는 연결하지 않는다.
# GPU0은 이미 약 121GB를 쓰고 있어(2026-11-12) GPU1에 띄운다. 밖으로 열지 않는다(127.0.0.1:8202).
# 사용: bash ~/gpu_server/start_vllm_eval.sh            → "ready", 로그는 ~/vllm_exp/serve_eval.log
#       MODEL=Qwen/Qwen3.5-35B-A3B-FP8 bash ~/gpu_server/start_vllm_eval.sh
# 끄기: pkill -f "[v]llm serve .*--port 8202"
set -u
MODEL=${MODEL:-Qwen/Qwen3.8-27B-FP8}
cd ~/vllm_exp
export PATH="$HOME/vllm_exp/.venv/bin:$PATH"
if curl -s -m 2 http://127.0.0.1:8202/v1/models > /dev/null; then echo "already running"; exit 0; fi
# FP8 DeepGEMM은 NVCC 12.9 이상이 필요해 끈다(start_vllm_story.sh와 같은 이유)
VLLM_USE_DEEP_GEMM=0 CUDA_VISIBLE_DEVICES=${GPU:-1} setsid nohup vllm serve "$MODEL" --host 127.0.0.1 --port 8202 \
  --gpu-memory-utilization ${GPU_UTIL:-0.32} --max-model-len ${MAX_LEN:-40960} --max-num-seqs ${MAX_SEQS:-8} \
  --limit-mm-per-prompt '{"image": 8, "video": 1}' --allowed-local-media-path "$HOME/vllm_exp/media" \
  > serve_eval.log 2>&1 < /dev/null &
for _ in $(seq 1 240); do
  curl -s -m 2 http://127.0.0.1:8202/v1/models > /dev/null && { echo ready; exit 0; }
  pgrep -u "$USER" -f "[v]llm serve .*--port 8202" > /dev/null || { echo "failed (serve_eval.log 확인)"; tail -5 serve_eval.log; exit 1; }
  sleep 5
done
echo "timeout"; exit 1

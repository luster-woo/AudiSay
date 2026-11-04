#!/usr/bin/env bash
# 장면 해설·요약·번역용 vLLM(서버 버전 15). 추론 서버(server.py)와 같은 모델을 GPU0에 메모리 17% 상한(버전 19: 25% → 17%, 약 24GB)으로 띄운다.
# 설치는 별도 가상환경 ~/vllm_exp/.venv(troubleshooting 20). 밖으로 열지 않는다(127.0.0.1).
# 사용: bash ~/gpu_server/start_vllm.sh   → 준비되면 "ready", 로그는 ~/vllm_exp/serve.log
set -u
cd ~/vllm_exp
export PATH="$HOME/vllm_exp/.venv/bin:$PATH"
if curl -s -m 2 http://127.0.0.1:8200/v1/models > /dev/null; then echo "already running"; exit 0; fi
CUDA_VISIBLE_DEVICES=0 setsid nohup vllm serve Qwen/Qwen3-VL-8B-Instruct --host 127.0.0.1 --port 8200 \
  --gpu-memory-utilization 0.17 --max-model-len 16384 --limit-mm-per-prompt '{"image": 8}' > serve.log 2>&1 < /dev/null &
for _ in $(seq 1 120); do
  curl -s -m 2 http://127.0.0.1:8200/v1/models > /dev/null && { echo ready; exit 0; }
  pgrep -u "$USER" -f "[b]in/vllm serve" > /dev/null || { echo "failed (serve.log 확인)"; tail -5 serve.log; exit 1; }
  sleep 5
done
echo "timeout"; exit 1

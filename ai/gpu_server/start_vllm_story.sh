#!/usr/bin/env bash
# 영상 전체 줄거리(/story)·영상 통째 해설용 Qwen3-VL-32B FP8 vLLM(서버 버전 17). 8B vLLM과 같은 GPU0에 메모리 42% 상한(약 60GB, 2026-11-04 35% → 42%: 영상 요청 하나가 KV 캐시 절반을 써서 두 편이 동시에 못 돌고 줄을 섰다)으로 띄운다(GPU1은 쓰지 않음).
# 2026-11-04 8B를 끈 뒤 50%·최대 길이 40960: 영상은 길이와 상관없이 약 23,500토큰이라 28672면 답이 5,100토큰에서 잘려
# 4분 넘는 영상(라바 6분 35초, 브레드이발소 7분 28초)이 JSON이 깨져 실패했다
# 밖으로 열지 않는다(127.0.0.1:8201). 꺼져 있으면 server.py가 8B로 대신한다.
# 사용: bash ~/gpu_server/start_vllm_story.sh   → 준비되면 "ready", 로그는 ~/vllm_exp/serve_story.log
set -u
mkdir -p ~/vllm_exp/media  # 영상 통째 보기(버전 18)용 저해상도 사본을 두는 곳
cd ~/vllm_exp
export PATH="$HOME/vllm_exp/.venv/bin:$PATH"
if curl -s -m 2 http://127.0.0.1:8201/v1/models > /dev/null; then echo "already running"; exit 0; fi
# FP8 기본 경로(DeepGEMM)는 NVCC 12.9 이상이 있어야 해서 끈다(H200 nvcc가 낮음, 2026-11-03)
VLLM_USE_DEEP_GEMM=0 CUDA_VISIBLE_DEVICES=0 setsid nohup vllm serve Qwen/Qwen3-VL-32B-Instruct-FP8 --host 127.0.0.1 --port 8201 \
  --gpu-memory-utilization ${GPU_UTIL:-0.5} --max-model-len ${MAX_LEN:-40960} --max-num-seqs 4 --limit-mm-per-prompt '{"image": 8, "video": 1}' \
  --allowed-local-media-path "$HOME/vllm_exp/media" \
  --mm-processor-kwargs "{\"size\": {\"longest_edge\": ${VIDEO_PIXELS:-37748736}, \"shortest_edge\": 4096}}" \
  > serve_story.log 2>&1 < /dev/null &
for _ in $(seq 1 180); do
  curl -s -m 2 http://127.0.0.1:8201/v1/models > /dev/null && { echo ready; exit 0; }
  pgrep -u "$USER" -f "[v]llm serve Qwen/Qwen3-VL-32B" > /dev/null || { echo "failed (serve_story.log 확인)"; tail -5 serve_story.log; exit 1; }
  sleep 5
done
echo "timeout"; exit 1

#!/usr/bin/env bash
# 장면 해설·요약·번역·영상 전체 줄거리(/story)·영상 통째 해설·JSON 생성을 맡는 vLLM(8201). 서버 버전 24(2026-11-12)부터
# Qwen3.8-27B FP8(이전: Qwen3-VL-32B FP8, 메모리 50%·max-num-seqs 4, start_vllm_story_v23_backup.sh).
# 27B는 받은 크기 29GB라 메모리 35%(약 50GB)로 충분하다: 시험(benchmarks/README.md)에서 32%로 영상 두 편 동시·장면 8개 동시가 줄 없이 돌았다.
# 최대 길이 40960: 영상 한 편 입력이 약 15,000~23,500토큰이고 답이 5,000토큰을 넘을 수 있다(4분 넘는 영상이 28672에서 잘렸다, 2026-11-04).
# --reasoning-parser qwen3: 생각 모드를 켜도(server.py VLLM_THINK=1) 생각 과정이 답과 따로 와서 JSON이 깨지지 않는다. 끈 상태에는 영향 없음.
# 32B 때 준 --mm-processor-kwargs(영상 프레임 크기)는 Qwen3-VL 처리기용이라 빼고, 시험과 같은 기본값으로 둔다.
# 밖으로 열지 않는다(127.0.0.1:8201). 꺼져 있으면 server.py가 HF 8B로 대신한다.
# 사용: bash ~/gpu_server/start_vllm_story.sh   → 준비되면 "ready", 로그는 ~/vllm_exp/serve_story.log
# 끄기: pkill -f "[v]llm serve .*--port 8201"
set -u
MODEL=${MODEL:-Qwen/Qwen3.8-27B-FP8}
mkdir -p ~/vllm_exp/media  # 영상 통째 보기(버전 18)용 저해상도 사본을 두는 곳
cd ~/vllm_exp
export PATH="$HOME/vllm_exp/.venv/bin:$PATH"
if curl -s -m 2 http://127.0.0.1:8201/v1/models > /dev/null; then echo "already running"; exit 0; fi
# FP8 기본 경로(DeepGEMM)는 NVCC 12.9 이상이 있어야 해서 끈다(H200 nvcc가 낮음, 2026-11-03)
VLLM_USE_DEEP_GEMM=0 CUDA_VISIBLE_DEVICES=${GPU:-0} setsid nohup vllm serve "$MODEL" --host 127.0.0.1 --port 8201 \
  --gpu-memory-utilization ${GPU_UTIL:-0.35} --max-model-len ${MAX_LEN:-40960} --max-num-seqs ${MAX_SEQS:-8} \
  --limit-mm-per-prompt '{"image": 8, "video": 1}' --allowed-local-media-path "$HOME/vllm_exp/media" \
  --reasoning-parser qwen3 > serve_story.log 2>&1 < /dev/null &
for _ in $(seq 1 180); do
  curl -s -m 2 http://127.0.0.1:8201/v1/models > /dev/null && { echo ready; exit 0; }
  pgrep -u "$USER" -f "[v]llm serve .*--port 8201" > /dev/null || { echo "failed (serve_story.log 확인)"; tail -5 serve_story.log; exit 1; }
  sleep 5
done
echo "timeout"; exit 1

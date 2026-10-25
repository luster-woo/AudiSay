#!/usr/bin/env bash
# AudiSay 서버 초기 설정 (Ubuntu)
# 사용법: sudo bash server-setup.sh
# 구성: Nginx·Certbot은 호스트에 설치, 나머지 서비스는 Docker Compose로 실행
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a   # needrestart가 재시작 여부를 묻지 않고 자동 처리

if [ "$EUID" -ne 0 ]; then
  echo "sudo로 실행하세요: sudo bash server-setup.sh"; exit 1
fi

TARGET_USER="${SUDO_USER:-ubuntu}"
if ! id "$TARGET_USER" >/dev/null 2>&1; then
  echo "사용자 '$TARGET_USER'가 없습니다. sudo로 실행하거나 TARGET_USER를 확인하세요."; exit 1
fi

# 실행 기록을 화면과 로그 파일에 함께 남김 (포팅 매뉴얼 작성용)
LOG_FILE=/var/log/server-setup.log
exec > >(tee -a "$LOG_FILE") 2>&1
echo "===== server-setup 시작: $(date '+%F %T') ====="

# 설정 파일 충돌 시 질문 없이 기존 파일 유지
APT_OPTS=(-y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold")

echo "===== [1/6] 패키지 업데이트, 시간대 ====="
apt-get update
apt-get "${APT_OPTS[@]}" upgrade
timedatectl set-timezone Asia/Seoul

echo "===== [2/6] 방화벽 (22 → 80 → 443 순서) ====="
apt-get "${APT_OPTS[@]}" install ufw
echo "--- 변경 전 상태 ---"
ufw status verbose || true
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp    # SSH 허용 + 30초에 6회 넘게 접속 시도하면 차단
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "--- 변경 후 상태 ---"
ufw status numbered

echo "===== [3/6] Docker Engine + Compose ====="
# 미리 설치된 비공식 패키지 제거 (containerd.io와 충돌 방지)
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    echo "기존 패키지 제거: $pkg"
    apt-get remove -y "$pkg"
  fi
done
apt-get "${APT_OPTS[@]}" install ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get "${APT_OPTS[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker "$TARGET_USER"

echo "===== [4/6] Docker 데몬 설정 ====="
# ip 127.0.0.1: compose의 ports:가 기본으로 서버 내부(localhost)에만 열림.
#   Docker는 UFW를 우회하므로, 실수로 "5432:5432"를 써도 외부에 노출되지 않게 막는 장치.
#   호스트 Nginx가 127.0.0.1:포트로 각 컨테이너에 프록시한다.
# live-restore: Docker 데몬을 재시작해도 실행 중인 컨테이너는 유지
# log-opts: 컨테이너당 로그 최대 10MB x 3개
if [ -f /etc/docker/daemon.json ]; then
  cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%Y%m%d%H%M%S)"
  echo "기존 daemon.json 백업 완료"
fi
cat > /etc/docker/daemon.json <<'EOF'
{
  "ip": "127.0.0.1",
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

echo "===== [5/6] Nginx, Certbot (호스트) ====="
apt-get "${APT_OPTS[@]}" install nginx certbot python3-certbot-nginx
systemctl enable --now nginx
nginx -t
# 인증서 자동 갱신 타이머 확인
systemctl list-timers --all | grep -i certbot || echo "certbot 타이머 없음: 'certbot renew --dry-run'으로 확인 필요"

echo "===== [6/6] 서버 사양·버전 (포팅 매뉴얼에 기록) ====="
echo "OS: $(. /etc/os-release && echo "$PRETTY_NAME")"
echo "커널: $(uname -r)"
echo "CPU 코어: $(nproc)"
free -h
df -h /
docker --version
docker compose version
nginx -v
certbot --version
echo "--- 외부에서 접속 가능한 열린 포트 (22, 80, 443만 있어야 정상) ---"
ss -tlnp | grep -vE '127\.0\.0\.[0-9]+:|\[::1\]:' || true

echo
if [ -f /var/run/reboot-required ]; then
  echo "※ 커널 등이 업데이트되어 재부팅이 필요합니다: sudo reboot"
fi
echo "완료. 다시 접속(exit 후 재접속)해야 sudo 없이 docker 명령을 쓸 수 있습니다."
echo "실행 기록: $LOG_FILE"

#!/usr/bin/env bash
# AudiSay 서버 초기 설정 (Ubuntu)
# 사용법: sudo bash server-setup.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ "$EUID" -ne 0 ]; then
  echo "sudo로 실행하세요: sudo bash server-setup.sh"; exit 1
fi
TARGET_USER="${SUDO_USER:-ubuntu}"

echo "===== [1/6] 패키지 업데이트, 시간대 ====="
apt-get update
apt-get upgrade -y
timedatectl set-timezone Asia/Seoul

echo "===== [2/6] 방화벽 (22 → 80 → 443 순서) ====="
apt-get install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status numbered

echo "===== [3/6] Docker Engine + Compose ====="
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$TARGET_USER"

echo "===== [4/6] Docker 로그 크기 제한 ====="
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

echo "===== [5/6] Nginx, Certbot ====="
apt-get install -y nginx certbot python3-certbot-nginx

echo "===== [6/6] 서버 사양 (포팅 매뉴얼에 기록) ====="
echo "CPU 코어: $(nproc)"
free -h
df -h /
docker --version
docker compose version

echo "완료. 다시 접속(exit 후 재접속)해야 sudo 없이 docker 명령을 쓸 수 있습니다."

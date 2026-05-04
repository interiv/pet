#!/bin/sh
set -e

CERT_DIR="/etc/nginx/certs"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
  echo "检测到 SSL 证书，启用 HTTPS"
else
  echo "未检测到 SSL 证书，生成自签名证书（浏览器会提示不安全，请尽快替换为正式证书）"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=localhost" 2>/dev/null
  echo "自签名证书已生成"
fi

exec nginx -g "daemon off;"

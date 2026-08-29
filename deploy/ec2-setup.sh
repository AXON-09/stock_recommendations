#!/usr/bin/env bash
# ==============================================================================
# QuantView AI — Automated EC2 Setup Script (Ubuntu 22.04 / 24.04 or Amazon Linux)
# Optimized for AWS Free Tier (t2.micro / t3.micro with 1GB RAM)
# ==============================================================================

set -e

echo "=== [1/6] Setting up Swap Memory (2GB) for Free Tier Stability ==="
# t2.micro has 1GB RAM. XGBoost, Pandas, and pip install require swap memory to avoid OOM.
if ! swapon --show | grep -q '/swapfile'; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap created successfully."
else
    echo "Swap already exists."
fi

echo "=== [2/6] Updating System & Installing Prerequisites ==="
if [ -f /etc/debian_version ]; then
    sudo apt-get update -y
    sudo apt-get install -y python3 python3-pip python3-venv git nginx curl
elif [ -f /etc/amazon-linux-release ]; then
    sudo dnf update -y
    sudo dnf install -y python3.11 python3.11-pip git nginx curl
fi

echo "=== [3/6] Setting Up Project Virtual Environment ==="
APP_DIR="/opt/quantview"
sudo mkdir -p "$APP_DIR"
sudo chown -R $USER:$USER "$APP_DIR"

# Navigate to project directory
cd "$APP_DIR"

# Create Python virtual environment
python3 -m venv venv || python3.11 -m venv venv
source venv/bin/activate

# Upgrade pip & install requirements
pip install --upgrade pip
pip install -r backend/requirements.txt

echo "=== [4/6] Creating Systemd Service for 24/7 Uptime ==="
sudo bash -c "cat <<EOF > /etc/systemd/system/quantview.service
[Unit]
Description=QuantView AI Stock Recommendation FastAPI Server
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl enable quantview
sudo systemctl restart quantview

echo "=== [5/6] Configuring Nginx Reverse Proxy (Port 80 -> Port 8000) ==="
if [ -d /etc/nginx/sites-available ]; then
    sudo bash -c 'cat <<EOF > /etc/nginx/sites-available/quantview
server {
    listen 80;
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
        proxy_connect_timeout 60s;
    }
}
EOF'
    sudo ln -sf /etc/nginx/sites-available/quantview /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
else
    # Amazon Linux / RedHat style nginx config
    sudo bash -c 'cat <<EOF > /etc/nginx/conf.d/quantview.conf
server {
    listen 80;
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
        proxy_connect_timeout 60s;
    }
}
EOF'
fi

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== [6/6] QuantView AI is Live! ==="
echo "Access your dashboard at: http://$(curl -s http://checkip.amazonaws.com || echo '<YOUR_EC2_PUBLIC_IP>')"

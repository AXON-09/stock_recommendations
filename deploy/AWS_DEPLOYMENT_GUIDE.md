# QuantView AI — AWS Free Tier Deployment Guide

This guide walks you through deploying **QuantView AI** on **Amazon Web Services (AWS)** completely within the **Free Tier** (100% free for 12 months).

---

## 📋 AWS Free Tier Overview for this Project

- **Instance Type**: `t2.micro` (or `t3.micro` in regions where available).
- **Free Limit**: **750 hours per month** (enough to run 1 instance 24/7 all month).
- **Storage**: Up to **30 GB General Purpose SSD (gp2/gp3)**.
- **Operating System**: **Ubuntu 24.04 LTS** or **Amazon Linux 2023** (Free Tier eligible).

---

## 🚀 Option 1: One-Click EC2 Deployment via AWS Console (Recommended)

### Step 1: Launch an EC2 Instance
1. Log in to your [AWS Management Console](https://console.aws.amazon.com/ec2/).
2. Select your preferred region (e.g., `ap-south-1` (Mumbai), `us-east-1` (N. Virginia), etc.).
3. Click **"Launch Instance"**.
4. **Name**: `QuantView-AI`
5. **Application and OS Images (AMI)**: Select **Ubuntu Server 24.04 LTS (HVM)** *(marked "Free tier eligible")*.
6. **Instance type**: Select `t2.micro` or `t3.micro` *(marked "Free tier eligible")*.
7. **Key pair**: Select an existing key pair or click **"Create new key pair"** (e.g., `quantview-key.pem`) and download it.

### Step 2: Configure Network & Security Group
Under **Network settings**:
- Check ✅ **Allow SSH traffic from anywhere (0.0.0.0/0)** or your IP.
- Check ✅ **Allow HTTP traffic from the internet (Port 80)**.
- Check ✅ **Allow HTTPS traffic from the internet (Port 443)**.
*(Optional)* Add a custom TCP rule for Port `8000` if you plan to connect directly to FastAPI.

### Step 3: Configure Storage
- **Size**: `15 GiB` (Free tier allows up to 30 GiB).
- **Volume type**: `gp3` or `gp2`.

### Step 4: Launch Instance
- Click **"Launch Instance"**.

---

## 💻 Step 5: Transfer Code & Deploy

Once the instance is in **Running** state:

### Method A: Using SSH / SCP from your Windows Terminal
Open PowerShell or Command Prompt on your local computer:

1. **Upload your code to EC2**:
   ```powershell
   # In PowerShell, navigate to where your .pem key is located:
   scp -i "path\to\quantview-key.pem" -r "C:\DOWNLOAD\Chrome\quantview-ai-audited\stock-recommender" ubuntu@<YOUR_EC2_PUBLIC_IP>:/home/ubuntu/stock-recommender
   ```

2. **Connect via SSH**:
   ```powershell
   ssh -i "path\to\quantview-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
   ```

3. **Move to destination and run setup**:
   ```bash
   sudo mkdir -p /opt/quantview
   sudo cp -r /home/ubuntu/stock-recommender/* /opt/quantview/
   sudo chown -R ubuntu:ubuntu /opt/quantview
   cd /opt/quantview
   chmod +x deploy/ec2-setup.sh
   ./deploy/ec2-setup.sh
   ```

### Method B: Using AWS EC2 Instance Connect (No SSH Keys Needed)
1. In the AWS Console, select your instance and click **"Connect"** -> **"EC2 Instance Connect"** -> **"Connect"**.
2. Clone your Git repository or download the code:
   ```bash
   git clone <YOUR_GITHUB_REPO_URL> /opt/quantview
   cd /opt/quantview
   chmod +x deploy/ec2-setup.sh
   ./deploy/ec2-setup.sh
   ```

---

## 🌐 Step 6: Access Your Live Dashboard

Open your browser and navigate to:
```
http://<YOUR_EC2_PUBLIC_IP>
```

- **Interactive UI**: `http://<YOUR_EC2_PUBLIC_IP>/`
- **FastAPI Swagger API Docs**: `http://<YOUR_EC2_PUBLIC_IP>/docs`
- **Health Check**: `http://<YOUR_EC2_PUBLIC_IP>/api/health`

---

## 🛠️ Service Management Commands on EC2

To manage your live service on EC2:
- **Check server status**: `sudo systemctl status quantview`
- **View live logs**: `sudo journalctl -u quantview -f`
- **Restart server**: `sudo systemctl restart quantview`
- **Restart Nginx**: `sudo systemctl restart nginx`

---

## 💡 Important Note on Free Tier RAM (Swap Memory)
AWS `t2.micro` has **1 GB RAM**. The `ec2-setup.sh` script automatically provisions a **2 GB Swap file**, ensuring that machine learning models (XGBoost, Pandas feature calculations) run smoothly without getting killed by Out-of-Memory (OOM) errors.

# 🚀 Deploy QuantView AI on Render (100% Free / ₹0)

Render offers a **completely free** web service hosting plan (no credit card required).

---

## 📋 Prerequisites
1. A free account on [GitHub](https://github.com).
2. A free account on [Render.com](https://render.com) (Sign in with GitHub).

---

## ⚡ Step 1: Push your project to GitHub

Open PowerShell on your computer and run:

```powershell
cd "C:\DOWNLOAD\Chrome\quantview-ai-audited\stock-recommender"

# Initialize git (if not already done)
git init
git add .
git commit -m "Deploy QuantView AI to Render"

# Link to your GitHub repository (create a new repository on GitHub first)
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin main
```

---

## 🌐 Step 2: Deploy on Render.com

1. Go to your [Render Dashboard](https://dashboard.render.com/).
2. Click the **"New +"** button at the top right and select **"Web Service"**.
3. Choose **"Build and deploy from a Git repository"** and click **Next**.
4. Connect your GitHub account and select your **`quantview`** repository.
5. Fill in the deployment details:

| Setting | Value |
| :--- | :--- |
| **Name** | `quantview-ai` (or any name you like) |
| **Language / Runtime** | `Python 3` |
| **Branch** | `main` |
| **Region** | Singapore / Oregon / Frankfurt (pick closest) |
| **Root Directory** | *(leave empty / blank)* |
| **Build Command** | `pip install --upgrade pip && pip install -r backend/requirements.txt` |
| **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | **Free ($0/month)** |

---

## ⚙️ Step 3: Add Environment Variables (Optional but Recommended)

Scroll down to the **Environment Variables** section on Render and add:
- `PYTHON_VERSION` = `3.11.9`
- `PYTHONUNBUFFERED` = `1`

---

## 🎉 Step 4: Click "Deploy Web Service"

1. Click **"Deploy Web Service"** at the bottom.
2. Render will automatically build the app, install dependencies, and launch your server.
3. Once the logs show `Application startup complete`, your app is **LIVE**!
4. Your free URL will look like:
   ```
   https://quantview-ai.onrender.com
   ```

---

## 💡 Notes on Render Free Tier:
- **Cost**: **₹0 / $0 completely free** forever.
- **Free SSL**: Automatic `https://` included.
- **Sleep mode**: If inactive for 15 minutes, free instances go to sleep to save resources. When someone visits the URL, it automatically wakes up in ~30–50 seconds.

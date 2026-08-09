#!/bin/bash
# Deployment script for Libre WebUI
# Frontend → Firebase Hosting (dqnlabsai.web.app)
# Backend → Railway

set -e

echo "=========================================="
echo "  Libre WebUI Deployment Script"
echo "=========================================="

# Check if Railway URL is provided
if [ -z "$RAILWAY_URL" ]; then
    echo ""
    echo "Step 1: Deploy backend to Railway first"
    echo "  1. Go to https://railway.app"
    echo "  2. Create new project from GitHub"
    echo "  3. Set environment variables (see railway.env.example)"
    echo "  4. Get your Railway app URL"
    echo ""
    echo "Then run: RAILWAY_URL=https://your-app.up.railway.app bash deploy.sh"
    exit 1
fi

echo "Railway URL: $RAILWAY_URL"

# Update frontend env
echo ""
echo "Step 2: Updating frontend config..."
cat > frontend/.env.production << EOF
VITE_API_BASE_URL=${RAILWAY_URL}/api
EOF
echo "  ✓ Frontend env updated"

# Rebuild frontend
echo ""
echo "Step 3: Rebuilding frontend..."
cd frontend && npm run build
cd ..
echo "  ✓ Frontend built"

# Deploy to Firebase
echo ""
echo "Step 4: Deploying to Firebase Hosting..."
npx firebase deploy --only hosting
echo "  ✓ Deployed to https://dqnlabsai.web.app"

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo "Frontend: https://dqnlabsai.web.app"
echo "Backend:  $RAILWAY_URL"

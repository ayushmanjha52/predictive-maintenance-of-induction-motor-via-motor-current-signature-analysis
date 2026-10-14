# One container: FastAPI serves the built frontend at / and the API under /api.
# Works on Hugging Face Spaces (Docker SDK), Google Cloud Run, Fly.io, Koyeb or any Docker host.

# ---- frontend build
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
# Public URL of the deployment, used for canonical/OG tags, sitemap.xml and robots.txt.
ARG SITE_URL=http://localhost:7860
RUN VITE_SITE_URL="$SITE_URL" npm run build

# ---- runtime
FROM python:3.11-slim
# ALLOWED_HOSTS / FRAME_ANCESTORS default to values that work on Hugging Face Spaces
# (served from *.hf.space, embedded on huggingface.co). Override them for other hosts.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    FRONTEND_DIST=/app/site \
    PORT=7860 \
    ALLOWED_HOSTS="localhost,127.0.0.1,*.hf.space" \
    FRAME_ANCESTORS="'self' https://huggingface.co"
RUN useradd --create-home --uid 1000 app
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./site
USER app
EXPOSE 7860
# --proxy-headers lets the rate limiter see client IPs behind the platform's proxy.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --no-server-header --proxy-headers --forwarded-allow-ips='*'"]

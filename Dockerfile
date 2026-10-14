FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg converts Gemini's WAV voice into OGG/Opus voice notes for Telegram.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
COPY data ./data
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]

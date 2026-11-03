# syntax=docker/dockerfile:1

# 0) 의존성 (package-lock이 안 바뀌면 전부 캐시)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# 1) lint + test (빌드와 분리: 실패해도 빌드 캐시에 영향 없음)
FROM deps AS test
COPY . .
RUN npm run lint && npm test

# 2) build
FROM deps AS build
COPY . .
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# 3) serve
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
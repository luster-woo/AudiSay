import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // 개발 서버가 /api 요청을 넘길 백엔드. 기본은 실서버, 로컬 백엔드는 .env.local 에서 바꾼다
  // (VITE_ 접두사가 없어서 브라우저 코드에는 들어가지 않는다)
  const env = loadEnv(mode, import.meta.dirname, '')
  const apiTarget = env.API_PROXY_TARGET || 'https://k15d101.p.ssafy.io'

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          // 서버가 쿠키에 Domain=k15d101.p.ssafy.io 를 붙여도 localhost 쿠키로 저장되게 한다 (RefreshToken)
          cookieDomainRewrite: { '*': '' },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})

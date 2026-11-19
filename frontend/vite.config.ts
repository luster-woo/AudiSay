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
    build: {
      rolldownOptions: {
        output: {
          // 라이브러리(react-dom·react-router·axios·TanStack Query, 약 398KB)는 한 파일로 따로 둔다.
          // 앱 코드만 바뀐 배포에서는 이 파일 이름(해시)이 그대로라, 다시 찾아온 사용자는 캐시에서 쓴다
          // 주의: 사용자 화면을 lazy 라우트로 나누면 Rolldown 런타임이 앱 공용 청크로 옮겨 가 vendor 와 서로 import 하고,
          // 빌드는 성공하지만 화면이 그려지지 않는다('e is not a function'). 나눌 때는 output.strictExecutionOrder 를 켜고 확인한다
          codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] },
        },
      },
    },
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
      pool: 'vmThreads',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})

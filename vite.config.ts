import path from "node:path";
// vitest의 vite 모듈 증강으로만 test 키가 존재한다 — "vite"에서 가져오면 타입 검증을 못 받는다
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    // react()보다 반드시 앞. 뒤에 두면 플러그인이 configResolved에서 에러를 던진다.
    // autoCodeSplitting은 라우트의 component를 별도 청크로 빼는데, 그 덕에
    // routeTree.gen.ts를 DOM 없는 Node 테스트에서 import할 수 있다 (__root는 예외 — 분리 안 됨).
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],

  // 라우터 seam 테스트 — 컴포넌트를 렌더하지 않아 기본 환경(node) 그대로 쓴다.
  // vitest 기본 제외는 node_modules와 .git뿐이라 dist까지 훑는다. 그래서 디렉터리만 src로
  // 좁히고 확장자 규칙은 기본 패턴을 그대로 둔다 — .test.tsx가 조용히 빠지면
  // 실행되지 않은 테스트가 CI에서 초록으로 통과한다.
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

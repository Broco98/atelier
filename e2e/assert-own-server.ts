import { BASE_URL, REPO_ROOT } from "./dev-server";

/**
 * 브라우저가 열 서버가 **이 워크트리의 것인지** 확인한다. 테스트보다 먼저 돈다.
 *
 * 포트를 나눠 놨어도 이 확인이 필요하다. Playwright는 dev 서버를 띄우기 전에 포트가
 * 비었는지 한 번 볼 뿐이라, 그 뒤에 남이 끼어들면 우리 vite는 `--strictPort`로 죽고
 * Playwright는 **남의 서버**로 테스트를 그대로 돌린다(실측 8/8). 그러면 다른 브랜치의
 * 코드를 검사하고 초록이 나온다 — 이 층이 없애려던 바로 그 상태다.
 *
 * 지문은 vite dev가 내려주는 모듈에 박히는 절대경로다. 트랜스폼이 바뀌어 지문이
 * 사라지면 이 확인은 **거짓 경보로 시끄럽게** 실패한다 — 조용히 남의 코드를 통과시키는
 * 것보다 그쪽이 낫다.
 */
export default async function assertOwnServer(): Promise<void> {
  const url = `${BASE_URL}/src/main.tsx`;
  const response = await fetch(url);
  const body = await response.text();

  if (!body.includes(REPO_ROOT)) {
    throw new Error(
      `L3가 볼 dev 서버가 이 워크트리의 것이 아닙니다.\n` +
        `  기대한 루트: ${REPO_ROOT}\n` +
        `  확인한 주소: ${url} (HTTP ${response.status})\n` +
        `누가 이 포트를 잡고 있는지 보세요: lsof -a -p $(lsof -ti :${new URL(BASE_URL).port} -sTCP:LISTEN) -d cwd`,
    );
  }
}

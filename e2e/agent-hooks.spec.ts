import { expect, test, type Page } from "./evidence";
import { callCount, installFixtureBackend, unknownIpcCalls } from "./harness";
import type { HookStatus } from "@/features/settings/types";

// **설정 › 에이전트 훅이 설치 상태 셋을 낱말로 보인다**(프로세스 결정 15 · 프로세스 스펙 S35 · 티켓 21). 없음 · 일부 · 전부 중
// 「일부」가 새로 선 낱말이다: 목록이 는 판에서 옛 훅만 깔린 사람, 도구 사건의 `async`가 빠진 사람, 옛 명령줄이 남은 사람이 그렇다.
// 판정은 Rust가 파일을 읽어 하고(`hooks.rs`의 `claude_installed` · `codex_installed`, L1), 낱말은 `hookStateLabel`이 짓는다(L2).
// 이 층이 드는 것은 **답의 새 모양이 화면의 그 자리까지 실제로 가는가**다 — 판정이 답에 실려도 화면이 옛 모양(참 · 거짓)으로
// 읽으면 「일부」가 「설치됨」으로 선다.

const HOOKS = "agent_hooks";

/** 한 에이전트의 줄. 상태 낱말과 경로가 한 상자에 선다 — 경로로 그 상자를 찾는다(줄에 접근성 이름이 없다). */
const 줄 = (page: Page, path: string) => page.getByText(path, { exact: true }).locator("xpath=..");

const status = (agent: string, path: string, installed: HookStatus["installed"]): HookStatus => ({
  agent,
  path,
  installed,
  error: null,
  writeError: null,
  preview: `${agent} 미리보기`,
});

test("설정 › 에이전트 훅에서 일부만 깔린 에이전트는 「업데이트 필요」로 보인다", async ({ page }) => {
  await installFixtureBackend(page, {
    [HOOKS]: [
      status("claude", "~/.claude/settings.json", "partial"),
      status("codex", "~/.codex/config.toml", "full"),
    ],
  });
  await page.goto("/settings/hooks");

  // 앵커: 답을 **물었고**, 다 깔린 옆 줄은 「설치됨」으로 섰다 — 같은 답의 다른 칸이 화면까지 왔다. 묻는 자리가 이펙트라
  // StrictMode(dev)에서는 두 번 묻는다. 수는 이 검사의 물음이 아니다.
  await expect.poll(() => callCount(page, HOOKS)).toBeGreaterThan(0);
  await expect(줄(page, "~/.codex/config.toml").getByText("설치됨", { exact: true })).toBeVisible();

  const claude = 줄(page, "~/.claude/settings.json");
  await expect(claude.getByText("업데이트 필요", { exact: true })).toBeVisible();
  // 「일부」를 옛 모양(참 · 거짓)으로 읽으면 글자가 있는 값이라 「설치됨」이 선다.
  await expect(claude.getByText("설치됨", { exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

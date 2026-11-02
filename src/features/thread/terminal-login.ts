import { showToast } from "@/components/ui/toast";
import { topTerminal, type ShellOwner } from "@/features/terminal/shell-registry";
import { openShellRunning } from "@/features/terminal/terminal-store";
import { threadApi } from "./api";
import type { Runtime } from "./types";

/**
 * 「터미널에서 로그인」(restart 01c-10 · 스펙 「01c — Codex」 로그인) — Host가 준 그 Runtime의 로그인 명령(`login_command` — 로그인 셸의
 * PATH에서 찾은 실행 파일)을 시작 명령으로 실어 **Terminal**(최상위 터미널)에 새 셸을 열고, 그 셸로 간다(`go` — 셸로 가는 길 하나,
 * `useGoToShell`). 앱은 로그인 명령을 띄우지 않는다 — 사람이 그 셸에서 로그인을 마치고 채팅으로 돌아와 「다시 확인」을 누르면 Host가
 * 기다리던 채팅을 다시 띄운다.
 *
 * - 셸 상한이면 열지 않고 지금의 셸 상한 안내(⌘T의 토스트와 같은 문장)를 거절 토스트로 보인다. 채팅 화면은 카드가 설 때 토스트 자리를 둔다.
 * - Host가 명령을 주지 못하면(로그인 셸을 못 읽음 · 못 찾음) 그 글로 거절된다 — 카드가 까닭으로 보인다. 못 찾음이면 Host가 그 Runtime의
 *   「못 찾음」을 알려 카드가 「설치 안내」로 바뀐다.
 */
export async function loginInTerminal(
  runtime: Runtime,
  go: (shell: { id: number; owner: ShellOwner }) => void,
): Promise<void> {
  const command = await threadApi.loginCommand(runtime);
  const origin = topTerminal();
  const opened = openShellRunning(origin, command);
  if ("notice" in opened) {
    showToast(opened.notice, "rejected");
    return;
  }
  go({ id: opened.id, owner: origin.owner });
}

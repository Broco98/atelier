import { AgentFace } from "./AgentFace";
import type { AskTurn, NextLine } from "./asks";
import type { Avatar } from "./faces";

// 물음 차례의 표시(v1 티켓 25 · 캔버스 Approval 보드 A안 「두 Agent가 함께 물을 때」) — 입력창 자리에 선 카드가 차례를 말하는 두 자리다.
// 차례는 `asks.ts`가 읽고, 카드(승인 카드 · 질문 카드)가 이 둘을 제 머리 오른쪽과 맨 아래에 둔다 — 카드 종류가 늘어도 같은 표시다.

/** 카드 머리 오른쪽의 「1 / 2」(보드 `.ap-h .cnt` — 12/20 `fg-tertiary`). 묶음에 물음이 하나뿐이면 서지 않는다. */
export function AskCount({ count }: { count: AskTurn["count"] }) {
  if (!count) return null;
  return (
    <span className="shrink-0 text-xs leading-5 text-fg-tertiary tabular-nums">
      {count.at} / {count.total}
    </span>
  );
}

/**
 * 카드 맨 아래 「다음 · **테스터**가 `pnpm playwright test` 실행을 기다려요」(보드 `.next`) — 위에 머리카락 선, 얼굴 16, 12/18
 * `fg-tertiary`이고 이름은 `fg-secondary` 500이다. 대상은 작업 로그의 그 도구 줄과 같은 글이라, 흐름에서 같은 줄을 찾을 수 있다.
 */
export function AskNext({ handle, avatar, line }: { handle: string; avatar: Avatar | null; line: NextLine }) {
  return (
    <p className="mx-1 flex items-center gap-2 border-t-[0.5px] border-border px-2 pt-2 pb-0.5 text-xs text-fg-tertiary">
      <AgentFace handle={handle} avatar={avatar} className="size-4 shrink-0" />
      <span className="min-w-0 wrap-anywhere">
        다음 · <b className="font-medium text-fg-secondary">{line.name}</b>
        {line.particle}{" "}
        {line.subject !== null && (
          <>
            <span className={line.mono ? "font-mono" : undefined}>{line.subject}</span>{" "}
          </>
        )}
        {line.what}
      </span>
    </p>
  );
}

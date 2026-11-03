import { FileDiff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArrival } from "./arrival";
import type { Changes } from "./log";

// 바뀐 파일 알약(v1 티켓 05 · Cards 보드 「바뀐 파일 알약」 「2개 파일 변경됨 +41 −4 검토」) — 입력창 위에 떠 끝난 마지막 턴의 편집을 센다
// (`log.ts`의 `changedFiles`). 다음 턴이 시작하면 마지막 턴이 바뀌어 걷힌다. 모양은 보드의 `.ra-pill`이다(restart 02b-9b) — 34 알약, 안쪽
// 왼 14 · 오 6, 떠 있는 면(`surface-elevated`)에 0.5 링 + 카드 그림자, 13/18, 글리프 `file-diff` 14, +/− 셈은 고른 폭 숫자다. 한때 셈과 「검토」
// 사이에 세로선이 있었다. 「검토」는 옅은 면(`fill-soft`)의 24 알약 12/18이고 올리면 hover 면과 본문 글자색이다. 누르면 카드가 넓어져 그 턴이
// 바꾼 첫 파일의 변경을 연다(SummarySheet 표 넷째 줄 — `reviewOf`). 한때 그 턴의 작업 로그를 펼쳤다. 「되돌리기」는 짓지 않는다. 입력창 위 세 칸 줄의 왼쪽 칸에 서서
// (`ThreadScreen` — 가운데는 「맨 아래로」) 칸 폭으로 늘지 않고 제 폭이다(`justify-self-start`).
//
// 화면이 선 뒤에 새로 서면 칩처럼 들어선다(Motion 「칩이 들어선다」 — 결정 줄 · 첨부 · 대기 줄 · 바뀐 파일 알약, restart 02b-7). 이름(`arrival`)은 그
// 턴이다 — 같은 턴의 알약이 자리를 옮겨 다시 서도 다시 들어서지 않는다.
function ChangesPill({ changes, arrival, onReview }: { changes: Changes; arrival?: string; onReview: () => void }) {
  return (
    <div
      role="group"
      aria-label={`${changes.files.length}개 파일 변경됨`}
      className={cn(
        "inline-flex h-8.5 shrink-0 items-center gap-2 justify-self-start rounded-full bg-surface-elevated pr-1.5 pl-3.5 text-chat-meta whitespace-nowrap shadow-lifted",
        useArrival("chip-in", arrival && `changes:${arrival}`),
      )}
    >
      <FileDiff className="size-3.5 shrink-0" aria-hidden />
      <span>{changes.files.length}개 파일 변경됨</span>
      <span className="text-diff-added tabular-nums">+{changes.added}</span>
      <span className="text-diff-deleted tabular-nums">−{changes.deleted}</span>
      <button
        type="button"
        tabIndex={0}
        onClick={onReview}
        className="flex h-6 items-center rounded-full bg-fill-soft px-2 text-xs tracking-normal text-fg-secondary transition-colors quiet-hover focus-ring"
      >
        검토
      </button>
    </div>
  );
}

export default ChangesPill;

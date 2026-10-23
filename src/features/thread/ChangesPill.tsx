import { File } from "lucide-react";
import type { Changes } from "./log";

// 바뀐 파일 알약(v1 티켓 05 · 캔버스 Composer · Cards 보드 「2개 파일 변경됨 +48 −4 | 검토」) — 입력창 위에 떠 마지막 턴의 편집을 센다
// (`log.ts`의 `changedFiles`). 다음 턴이 시작하면 마지막 턴이 바뀌어 걷힌다. 모양은 보드의 `.fcp`(34 · 알약 · 떠 있는 면과 카드 그림자 ·
// 13/18)다. 「검토」는 그 턴의 작업 로그를 펼쳐 바뀐 줄을 보이는 자리로 데려간다 — Work 패널(31)이 서면 그쪽에서 연다. 「되돌리기」는
// 짓지 않는다.
function ChangesPill({ changes, onReview }: { changes: Changes; onReview: () => void }) {
  return (
    <div
      role="group"
      aria-label={`${changes.files.length}개 파일 변경됨`}
      className="inline-flex h-8.5 shrink-0 items-center gap-2 rounded-full bg-surface pr-1.5 pl-3 text-chat-meta whitespace-nowrap shadow-lifted"
    >
      <File className="size-3.5 shrink-0" aria-hidden />
      <span>{changes.files.length}개 파일 변경됨</span>
      <span className="text-diff-added">+{changes.added}</span>
      <span className="text-diff-deleted">−{changes.deleted}</span>
      <span aria-hidden className="h-4 w-[0.5px] bg-border-heavy" />
      <button
        type="button"
        onClick={onReview}
        className="flex h-6 items-center rounded-full px-2 text-fg-secondary transition-colors quiet-hover focus-ring"
      >
        검토
      </button>
    </div>
  );
}

export default ChangesPill;

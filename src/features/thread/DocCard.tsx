import { ChevronRight, FileText } from "lucide-react";
import { particle } from "@/lib/particle";
import type { CreatedDoc } from "./expanded";

/**
 * 대화 속 문서 카드(v1 티켓 35 · 스토리 102 · 캔버스 Messages 보드 「파일과 첨부 — Agent가 만든 파일」 `.fcard`) — Agent가 이은 Work의 spec
 * 폴더에 새로 쓴 문서가 그 턴의 답 아래에 카드로 놓인다(`createdDocs`). 누르면 요약 카드가 넓어져 그 문서를 연다.
 *
 * 모양은 보드 값이다 — 폭 420까지 · 안쪽 10/12/10/10 · 반경 16 · 얇은 그림자 · 흰 면(가리키면 `fill-soft`), 왼쪽에 40 상자(반경 10 ·
 * `fill-soft`)의 문서 글리프, 이름 14/20 500 · 메타 12/18 `fg-tertiary`, 오른쪽 끝 「열기 ›」 13 `fg-secondary`. 보드의 그림 카드
 * (「테스터가 만듦 · 1280×720」)는 짓지 않았다 — 그림의 크기를 읽는 길이 없다.
 */
export function DocCard({ doc, name, onOpen }: { doc: CreatedDoc; name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-doc-card={doc.path}
      onClick={onOpen}
      className="flex w-full max-w-105 items-center gap-3 rounded-2xl bg-surface py-2.5 pr-3 pl-2.5 text-left shadow-hairline transition-colors hover:bg-fill-soft focus-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-fill-soft text-fg-secondary">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{doc.path}</span>
        <span className="truncate text-xs text-fg-tertiary">
          {`${name}${particle(name, "이", "가")} 만듦 · ${doc.lines}줄 · 같이 고칠 수 있어요`}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-chat-meta text-fg-secondary">
        열기
        <ChevronRight className="size-3.5" aria-hidden />
      </span>
    </button>
  );
}

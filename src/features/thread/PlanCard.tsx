import { Circle, CircleCheck, Map as MapIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "./fold";
import ThreadMarkdown from "./ThreadMarkdown";

// 계획 카드와 계획 체크리스트(three-axes 티켓 21 · 결정 29) — 흐름 안에 서는 계획의 두 모양이다. 모양은 캔버스 Tools 보드 「계획 —
// 카드 · 승인 · 체크리스트」다. 계획을 받아들이는 「이 계획대로 할까요?」 카드는 여기 없다 — 승인 카드와 같은 틀로 입력창 자리에
// 선다(`ApprovalCard`).
//
// - **계획 카드**는 엔진의 계획(Codex `plan_update`의 markdown · 계획 승인 요청의 계획 본문)을 마크다운 그대로 그린다(스토리 65).
//   Session에 하나라 다음 계획이 오면 이 카드의 글이 바뀐다(`fold.ts`). 면 카드(`surface` · r16 · 0.5px 선) · 머리는 턴 머리줄의 꼴에 지도 아이콘과
//   「계획」이다.
// - **체크리스트**는 ACP `plan`의 항목들이다 — 엔진이 보낼 때만 선다(스토리 67). 끝난 항목은 초록 체크와 줄긋기, 도는 항목은
//   스피너, 남은 항목은 빈 원이다. 상태는 색 · 아이콘이 아니라 글로도 읽히게 항목마다 숨은 글을 단다.

export function PlanCard({ text }: { text: string }) {
  return (
    <section
      role="group"
      aria-label="계획"
      className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3.5 ring-[0.5px] ring-border-heavy"
    >
      <span className="flex items-center gap-1.5 text-chat-meta text-fg-tertiary">
        <MapIcon className="size-3.5" aria-hidden />
        계획
      </span>
      <ThreadMarkdown text={text} />
    </section>
  );
}

const STATUS: Record<string, string> = { completed: "끝남", in_progress: "하는 중", pending: "남음" };

export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul
      aria-label="계획 체크리스트"
      className="flex flex-col gap-1 rounded-xl bg-surface-under px-3.5 py-2.5 text-chat-meta leading-5 inset-ring-[0.5px] inset-ring-border"
    >
      {items.map((item, at) => (
        <li key={at} className="flex items-center gap-2">
          {item.status === "completed" ? (
            <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
          ) : item.status === "in_progress" ? (
            <Spinner className="size-3.5 text-fg-secondary" aria-hidden />
          ) : (
            <Circle className="size-3.5 shrink-0 text-fg-tertiary" aria-hidden />
          )}
          <span className={cn("min-w-0 wrap-anywhere", item.status === "completed" && "text-fg-tertiary line-through")}>
            {item.content}
          </span>
          <span className="sr-only">{` · ${STATUS[item.status] ?? item.status}`}</span>
        </li>
      ))}
    </ul>
  );
}

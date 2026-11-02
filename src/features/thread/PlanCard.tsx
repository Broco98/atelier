import { Check, ListChecks, Map as MapIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "./fold";
import ThreadMarkdown from "./ThreadMarkdown";

// 계획 카드와 계획 체크리스트(three-axes 티켓 21 · 결정 29 · restart 02b-4) — 흐름 안에 서는 계획의 두 모양이다. 모양은 Tools 보드 「계획 체크리스트」 ·
// 「계획 카드」의 `.ra-plan`이다 — `fill-soft` 상자(둥근 12 · 안쪽 10 12 · 줄 사이 2), 머리는 글리프 14와 「계획」(13 / 18 · 500). 계획을 받아들이는
// 「이 계획대로 할까요?」 카드는 여기 없다 — 승인 카드와 같은 틀로 입력창 자리에 선다(`ApprovalCard`).
//
// - **계획 카드**는 엔진의 계획(Codex `plan_update`의 markdown · 계획 승인 요청의 계획 본문)을 마크다운 그대로 그린다(스토리 65). 머리 글리프는 지도다.
//   Session에 하나라 다음 계획이 오면 이 카드의 글이 바뀐다(`fold.ts`). 한때 면 카드(`surface` · r16 · 0.5px 선)에 옅은 머리였다.
// - **체크리스트**는 ACP `plan`의 항목들이다 — 엔진이 보낼 때만 선다(스토리 67). 머리 글리프는 체크 목록이고 오른쪽에 「1 / 3」(끝난 수 · `fg-tertiary`)이
//   선다. 항목은 24 줄 · 13 / 18 `fg-secondary` · 사이 8에 표지 14다 — 끝난 항목은 초록 ✓와 줄긋기 · `fg-tertiary`, 도는 항목은 회전(DS `Spinner`) · `fg`, 남은
//   항목은 빈 원(12 · 1 `border-heavy`)이다. 상태는 색 · 아이콘이 아니라 글로도 읽히게 항목마다 숨은 글을 단다. 한때 `surface-under` 상자에 원 · 체크 원이었다.

const PLAN = "flex flex-col gap-0.5 rounded-xl bg-fill-soft px-3 py-2.5";
const PLAN_HEAD = "flex items-center gap-1.5 pb-1 text-chat-meta font-medium text-fg";

export function PlanCard({ text }: { text: string }) {
  return (
    <section role="group" aria-label="계획" className={PLAN}>
      <span className={PLAN_HEAD}>
        <MapIcon className="size-3.5 shrink-0" aria-hidden />
        계획
      </span>
      <ThreadMarkdown text={text} />
    </section>
  );
}

const STATUS: Record<string, string> = { completed: "끝남", in_progress: "하는 중", pending: "남음" };

export function Checklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((item) => item.status === "completed").length;
  return (
    <section role="group" aria-label="계획 체크리스트" className={PLAN}>
      <span className={PLAN_HEAD} aria-hidden>
        <ListChecks className="size-3.5 shrink-0" />
        계획
        <span className="ml-auto font-normal text-fg-tertiary tabular-nums">
          {done} / {items.length}
        </span>
      </span>
      <ul className="flex flex-col gap-0.5">
        {items.map((item, at) => (
          <li
            key={at}
            data-status={item.status}
            className={cn(
              "flex min-h-6 items-center gap-2 text-chat-meta text-fg-secondary transition-colors duration-basic ease-default",
              item.status === "completed" && "text-fg-tertiary",
              item.status === "in_progress" && "text-fg",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
              {item.status === "completed" ? (
                <Check className="size-3.5 text-success" />
              ) : item.status === "in_progress" ? (
                <Spinner className="spin-thread size-3 text-fg-secondary" />
              ) : (
                <span className="size-3 rounded-full inset-ring inset-ring-border-heavy" />
              )}
            </span>
            <span className={cn("min-w-0 wrap-anywhere", item.status === "completed" && "line-through")}>{item.content}</span>
            <span className="sr-only">{` · ${STATUS[item.status] ?? item.status}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

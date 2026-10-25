import { createContext, useContext } from "react";
import { Book, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useArrival } from "./arrival";
import type { ResultEntry } from "./fold";
import { resultCardView, resultTarget, type ResultTarget, type ResultTo } from "./result-card";

// **결과 카드**(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「대화로 한 설정 — 결과 카드」 · F4-ThreadNoWork) — Agent가 대화로 한 설정
// (Project 추가 · Project 고침 · Space 만듦 · Space 고침) 하나가 남긴 `setting` 줄이다. 그 턴 안 도구 줄 뒤에 서고, 턴이 접히면 작업 구분선 아래 ·
// 답 앞에 남는다(F4-ThreadNoWork). 승인 카드가 아니라 이미 한 일의 기록이라 되돌리기 단추가 없고, 「열기」(Space 고침은 「관계 보기」)로 그 설정
// 화면에 가서 사람이 다시 고친다.
//
//   [아이콘 32] 첫 줄 14/20 · 흐린 둘째 줄(한 줄로 자른다)            [열기]
//
// - 캔버스 `.rc`: 1px `separator-soft` · 흰 면 · 둥글기 12 · 안쪽 10/10/10/12 · 사이 12, 아이콘 상자 32(`fill-soft` · 반경 10)의 책(Project) ·
//   층(Space) 글리프 16, 오른쪽 28 테두리 단추.
// - **대상이 그사이 사라졌으면 단추가 꺼진다**(`resultCardView`의 `gone`) — 지금 목록은 그리는 자리(Thread 화면)가 `ResultPlace`로 준다. 카드는
//   훅 없이 그린다(정적 마크업으로 잰다).

/** 카드의 동작 — Thread 화면이 준다. */
export interface ResultActions {
  /** 지금 그 갈래 목록의 slug들 — 아직 읽지 못했으면 null(단추를 켜 둔다). */
  listed: (target: ResultTarget) => readonly string[] | null;
  /** 「열기」 · 「관계 보기」 — 그 상세 화면으로 간다. */
  open: (to: ResultTo) => void;
}

export const ResultPlace = createContext<ResultActions>({ listed: () => null, open: () => {} });

const ICONS = { project: Book, space: Layers } as const;

export function ResultCard({ card }: { card: ResultEntry }) {
  const actions = useContext(ResultPlace);
  const view = resultCardView(card, actions.listed(resultTarget(card)));
  const Icon = ICONS[view.icon];
  return (
    <section
      aria-label={view.title}
      data-result={card.action}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-separator-soft bg-surface py-2.5 pr-2.5 pl-3",
        useArrival("row-in", card.key),
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill-soft text-fg-secondary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm wrap-anywhere text-fg">{view.title}</span>
        <span className="truncate text-xs text-fg-tertiary">{view.detail}</span>
      </span>
      <Button
        variant="outline"
        size="top"
        disabled={view.gone}
        title={view.gone ? "그사이 사라졌어요" : undefined}
        onClick={() => actions.open(view.to)}
      >
        {view.action}
      </Button>
    </section>
  );
}

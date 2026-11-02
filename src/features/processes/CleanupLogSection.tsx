import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { eventKeys, eventLabel, eventOutcome, eventWhat, loggedAt, outcomeLabel, reasonLabel, targetLabel } from "./cleanup-log";
import type { SectionFold } from "./folds";
import { FoldChevron, ROW_RULE, Section } from "./tree-rows";
import type { CleanupEvent } from "./types";

/**
 * **정리 기록 묶음**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32) — 앱이 무엇을 언제 왜 끝냈는가. 화면의 맨 끝에 선다. 사건마다 한
 * 줄(까닭 · 대상 수 · 때)이고 새것부터다(Rust가 그 차례로 준다 — 최근 100건). 줄을 누르면 펼쳐져 대상마다 이름 · 결과 · 명령줄이
 * 선다. 보기만 한다 — 기록을 지우는 길은 없다.
 *
 * 기록은 화면이 스냅샷이 올 때마다 한 번 물어 넘긴다(`useCleanupLog`) — 어느 구획이 섰는지가 접힘의 기억에 들어서다. 기록이 없으면 이
 * 묶음은 안 선다(다른 묶음과 같다). 구획은 접어 연다 — 참고용이다(ui-refresh 결정 28). 머리의 수는 접혀 있어도 선다(「N건」 — 시안 Processes).
 */
function CleanupLogSection({ events, fold }: { events: ReadonlyArray<CleanupEvent>; fold: SectionFold }) {
  // 펼친 사건 — 사건의 열쇠로 든다(`eventKeys` — 목록 안 자리가 아니다). 박자마다 새 목록이 와도, 새 사건이 맨 위에 서도 펼친 것이
  // 그대로다. 구획을 접었다 펴도 그대로다 — 구획의 몸이 내려가도 이 상태는 구획 밖(이 묶음)에 산다.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (events.length === 0) return null;
  const keys = eventKeys(events);

  // 여닫이 부품은 **다음** 상태를 알린다 — 받은 값을 그대로 적는다(`SpecTree`와 같다).
  const openFor = (key: string, next: boolean) =>
    setOpen((was) => {
      const opened = new Set(was);
      if (next) opened.add(key);
      else opened.delete(key);
      return opened;
    });

  return (
    <Section title="정리 기록" note={`${events.length}건`} fold={fold}>
      <ol aria-label="정리 기록" className="flex flex-col">
        {events.map((event, at) => {
          const key = keys[at];
          return <EventRow key={key} event={event} open={open.has(key)} onOpenChange={(next) => openFor(key, next)} />;
        })}
      </ol>
    </Section>
  );
}

/**
 * 사건 한 줄 — 누르면 대상이 펼쳐진다. **여닫음은 앱의 여닫이 부품이 든다**(`Collapsible` 기본 변형 — `SpecTree`의 폴더와 같은
 * 부품): 줄이 트리거라 `aria-expanded`를 스스로 달고, 대상 목록은 패널이다. 기본 변형이라 움직임 없이 바로 접히고 닫히면 내려간다 —
 * 펼친 것은 사건의 열쇠로 화면이 든다(`eventKeys`). **버튼의 이름이 그 줄의 한 문장이다**(`eventLabel`) — 안의 글자 조각을 이어 읽지
 * 않는다.
 */
function EventRow({
  event,
  open,
  onOpenChange,
}: {
  event: CleanupEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const outcome = eventOutcome(event);
  return (
    // 사건 하나가 표의 한 줄이다 — 아래 0.5px 선(`ROW_RULE`)이 펼친 대상까지 담아 다음 사건과 가른다.
    <Collapsible open={open} onOpenChange={onOpenChange} render={<li />} className={cn("flex flex-col", ROW_RULE)}>
      {/* 사건 줄 — 시안 Processes `.pr-logrow`: 32 · 13 `fg-secondary`, 때(110 · `fg-tertiary` 고정폭) · 까닭(96) · 대상 · 결과(72 · 오른쪽,
          못 끝냄은 경고 잉크)의 격자이고 왼쪽 30이 셰브론 자리다(안쪽 12 + 셰브론 칸 18). hover는 행 단(`fill-soft`)이다. */}
      <CollapsibleTrigger
        aria-label={eventLabel(event)}
        className="relative grid h-8 min-w-0 grid-cols-[110px_96px_minmax(0,1fr)_72px] items-center gap-x-3 pr-3 pl-7.5 text-left text-chat-meta text-fg-secondary transition-colors hover:bg-fill-soft focus-ring"
      >
        <span className="absolute top-0 left-3 grid h-8 w-4.5 place-items-center text-fg-tertiary">
          <FoldChevron open={open} />
        </span>
        <span className="truncate text-fg-tertiary tabular-nums">{loggedAt(event.at)}</span>
        <span className="truncate">{reasonLabel(event.reason)}</span>
        <span className="truncate">{eventWhat(event)}</span>
        <span data-outcome={outcome.bad ? "bad" : undefined} className={cn("truncate text-right", outcome.bad && "text-warning")}>
          {outcome.text}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* 대상은 때 글자와 같은 x에서 선다 — 셰브론 자리 30. */}
        <ul aria-label={`${reasonLabel(event.reason)}의 대상`} className="flex flex-col gap-1 pr-3 pb-2 pl-7.5">
          {event.targets.map((target, at) => (
            // 대상 한 줄 — 이름 · 결과, 그 밑에 명령줄. 명령줄은 Rust가 적을 때 앞 200자로 잘랐다(토큰 같은 비밀 — S12). 줄을 넘기며
            // 다 보인다: 무엇을 끝냈는지 읽는 자리라 말줄임으로 자르지 않는다.
            <li key={`${target.pid}#${at}`} aria-label={targetLabel(target)} className="flex min-w-0 flex-col text-chat-meta">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{target.name}</span>
                <span className="shrink-0 text-fg-tertiary">{outcomeLabel(target.outcome)}</span>
              </span>
              {target.command && (
                <span data-cell="command" className="break-all font-mono text-xs text-fg-secondary">
                  {target.command}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default CleanupLogSection;

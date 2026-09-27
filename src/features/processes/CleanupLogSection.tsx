import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { eventKeys, eventLabel, loggedAt, outcomeLabel, reasonLabel, targetLabel } from "./cleanup-log";
import { useCleanupLog } from "./hooks";
import { processCount } from "./process-tree";
import { Section } from "./tree-rows";
import type { CleanupEvent } from "./types";

/**
 * **정리 기록 묶음**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32) — 앱이 무엇을 언제 왜 끝냈는가. 화면의 맨 끝에 선다. 사건마다 한
 * 줄(까닭 · 대상 수 · 때)이고 새것부터다(Rust가 그 차례로 준다 — 최근 100건). 줄을 누르면 펼쳐져 대상마다 이름 · 결과 · 명령줄이
 * 선다. 보기만 한다 — 기록을 지우는 길은 없다.
 *
 * 기록은 스냅샷이 올 때마다 한 번 묻는다(`useCleanupLog`) — 도착한 때는 화면이 넘긴다(스냅샷 박자를 또 걸지 않게). 기록이 없으면 이
 * 묶음은 안 선다(다른 묶음과 같다).
 */
function CleanupLogSection({ snapshotAt }: { snapshotAt: number }) {
  const { data: events = [] } = useCleanupLog(snapshotAt);
  // 펼친 사건 — 사건의 열쇠로 든다(`eventKeys` — 목록 안 자리가 아니다). 박자마다 새 목록이 와도, 새 사건이 맨 위에 서도 펼친 것이
  // 그대로다.
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
    <Section title="정리 기록" note={`기록 ${events.length}건`}>
      <ol aria-label="정리 기록" className="flex flex-col gap-0.5">
        {events.map((event, at) => {
          const key = keys[at];
          return <EventRow key={key} event={event} open={open.has(key)} onOpenChange={(next) => openFor(key, next)} />;
        })}
      </ol>
    </Section>
  );
}

/**
 * 사건 한 줄 — 누르면 대상이 펼쳐진다. **여닫음은 앱의 여닫이 부품이 든다**(`Collapsible` 기본 변형 — `ArchiveList` · `SpecTree`와 같은
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
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} render={<li />} className="flex flex-col">
      <CollapsibleTrigger
        aria-label={eventLabel(event)}
        className="flex h-8 min-w-0 items-center gap-2 rounded-[8px] pr-1 text-left transition-colors quiet-hover"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 text-tertiary transition-transform", open && "rotate-90")}
        />
        <span className="shrink-0 text-[13px] font-medium">{reasonLabel(event.reason)}</span>
        <span className="shrink-0 text-[12px] text-tertiary">{processCount(event.targets.length)}</span>
        <span className="flex-1" />
        <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">{loggedAt(event.at)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label={`${reasonLabel(event.reason)}의 대상`} className="flex flex-col gap-1 pb-2 pl-[22px]">
          {event.targets.map((target, at) => (
            // 대상 한 줄 — 이름 · 결과, 그 밑에 명령줄. 명령줄은 Rust가 적을 때 앞 200자로 잘랐다(토큰 같은 비밀 — S12). 줄을 넘기며
            // 다 보인다: 무엇을 끝냈는지 읽는 자리라 말줄임으로 자르지 않는다.
            <li key={`${target.pid}#${at}`} aria-label={targetLabel(target)} className="flex min-w-0 flex-col text-[12.5px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{target.name}</span>
                <span className="shrink-0 text-tertiary">{outcomeLabel(target.outcome)}</span>
              </span>
              {target.command && (
                <span data-cell="command" className="break-all font-mono text-[11.5px] text-muted-foreground">
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

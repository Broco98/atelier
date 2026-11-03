import { cn } from "@/lib/utils";
import { cleanupRows } from "./cleanup-log";
import type { SectionFold } from "./folds";
import { ROW_RULE, Section } from "./tree-rows";
import type { CleanupEvent } from "./types";

/**
 * **정리 기록 묶음**(프로세스 결정 6 · 프로세스 스펙 S12 · 티켓 32) — 앱이 무엇을 언제 왜 끝냈는가. 화면의 맨 끝에 선다. **대상마다 한
 * 줄**(때 · 까닭 · 대상 · 결과 — restart 03-15d · 시안 Processes)이고 새것부터다(Rust가 사건을 그 차례로 준다 — 최근 100건). 기록은 사건
 * 단위로 오고 화면이 편다(`cleanupRows`). 줄은 누르지 않는다 — 셰브론도 펼침도 없다. 보기만 한다 — 기록을 지우는 길은 없다.
 *
 * 기록은 화면이 스냅샷이 올 때마다 한 번 물어 넘긴다(`useCleanupLog`) — 어느 구획이 섰는지가 접힘의 기억에 들어서다. 줄이 없으면 이
 * 묶음은 안 선다(다른 묶음과 같다). 구획은 접어 연다 — 참고용이다(ui-refresh 결정 28). 머리의 수는 줄의 수이고 접혀 있어도 선다
 * (「N건」 — 시안 Processes는 줄을 센다).
 */
function CleanupLogSection({ events, fold }: { events: ReadonlyArray<CleanupEvent>; fold: SectionFold }) {
  const rows = cleanupRows(events);
  if (rows.length === 0) return null;
  return (
    <Section title="정리 기록" note={`${rows.length}건`} fold={fold}>
      <ol aria-label="정리 기록" className="flex flex-col">
        {rows.map((row) => (
          // 줄 — 시안 Processes `.pr-logrow`: 최소 32 · 13 / 19 `fg-secondary`, 때(110 · `fg-tertiary` 고정폭 숫자) · 까닭(96) · 대상 · 결과(72 ·
          // 오른쪽, 못 끝냄은 경고 잉크)의 격자, 사이 12, 안쪽 왼 30 · 오 12, 아래 0.5px 선(`ROW_RULE`). 지나는 면은 없다(보드에 없다).
          <li
            key={row.key}
            className={cn(
              "grid min-h-8 min-w-0 grid-cols-[110px_96px_minmax(0,1fr)_72px] items-center gap-x-3 pr-3 pl-7.5 text-chat-meta leading-4.75 text-fg-secondary",
              ROW_RULE,
            )}
          >
            <span className="truncate text-fg-tertiary tabular-nums">{row.when}</span>
            <span className="truncate">{row.why}</span>
            <span className="truncate">{row.what}</span>
            <span data-outcome={row.bad ? "bad" : undefined} className={cn("truncate text-right", row.bad && "text-warning")}>
              {row.outcome}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export default CleanupLogSection;

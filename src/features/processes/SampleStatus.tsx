import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readSnapshotNow } from "./hooks";
import { beatOf, beatText, type AskClock, type SampleBeat, type SampleNote, type SnapshotState } from "./sample-beat";

// **믿을 수 있는 표시의 자리**(restart 03-9 · 시안 Processes의 머리 `pr-beat`와 안내 띠 `pr-note`). 무엇을 말할지는 `sample-beat.ts`가
// 가르고, 여기는 그것을 세운다. 숫자를 옅게 하는 것은 화면이 든다 — 구르는 몸에 `data-stale`을 달고 숫자 칸이 그것을 읽는다
// (`group-data-stale/sample`).

/** 묻는 동안 시계가 가는 박자 — 「N초째」가 1초씩 오른다. */
const TICK_MS = 1_000;

/**
 * **이 화면의 머리 상태** — 스냅샷 쿼리의 상태(`useProcessSnapshot`의 결과를 그대로 받는다)와 화면을 연 때로 가른다(`beatOf`). 화면을 연 때는
 * 이 화면이 선 순간이다 — 값이 한 번도 안 왔을 때 몇 초째인지를 거기서 센다.
 *
 * **묻는 동안만 시계가 간다** — 물음이 안 끝나는 멈춤(멎은 IPC)은 실패도 새 값도 안 와 다시 그릴 까닭이 없으니, 물음이 나간 때를 쥐고 1초마다
 * 지금을 적는다(`AskClock`). 물음이 끝나면 시계도 멎는다. 평소의 물음은 1초 안에 끝나 시계가 한 번도 안 가고, 화면이 따로 다시 그려지지
 * 않는다. 다시 읽기가 멎은 물음을 버리고 새로 물어도 묻는 중은 이어져 시계가 그대로다 — 마지막 값부터 세는 멈춤이 남는다.
 */
export function useSampleBeat(state: SnapshotState): SampleBeat {
  const [openedAt] = useState(() => Date.now());
  const [clock, setClock] = useState<AskClock | null>(null);
  const asking = state.fetchStatus === "fetching";
  useEffect(() => {
    if (!asking) return;
    const askedAt = Date.now();
    const timer = window.setInterval(() => setClock({ askedAt, now: Date.now() }), TICK_MS);
    return () => {
      window.clearInterval(timer);
      setClock(null);
    };
  }, [asking]);
  return beatOf(state, openedAt, clock);
}

/** 상태마다 점의 색 — 잰 값은 성공, 기다림은 옅은 글자, 멈춤은 경고(시안 `.pr-beat i`). */
const DOT: Record<SampleBeat["kind"], string> = {
  waiting: "bg-fg-tertiary",
  live: "bg-success",
  stalled: "bg-warning",
};

/**
 * **머리의 잰 시각**(스토리 129 · 130 · 131 · 시안 `pr-beat`) — 6px 점과 12 글자(`fg-tertiary` · 고정폭 숫자). 「재는 중」 · 「14:02:31에 잰 값 ·
 * 2초마다」 · 「8초째 새 값이 없어요」이고, 멈춤은 점과 글자가 경고 색이다. 화면 이름(h1 「Processes」) 바로 옆에 선다(restart 03-11 — 한때 틀의
 * 머리 줄이 글자 조각만 받아 몸의 맨 위에 따로 섰다).
 *
 * **점은 새 값이 온 순간에만 한 번 번진다**(시안 ProcessSheet 「표본 점」 — 700ms `ease-out`, 시계로 깜빡이지 않는다 · 동작 줄이기면 없음). 잰
 * 시각이 바뀔 때마다 점을 새로 세워(`key`) 번짐이 처음부터 돈다(`beat-pulse`). 기다림 · 멈춤은 번지지 않는다.
 *
 * 글자는 박자마다 바뀌어 읽어 주는 자리(`aria-live`)로 두지 않는다 — 2초마다 시각을 읽어 준다. 멈춤은 안내 띠(`role="status"`)가 한 번 말한다.
 */
export function BeatLine({ beat }: { beat: SampleBeat }) {
  return (
    <span
      data-beat={beat.kind}
      className="inline-flex min-w-0 items-center gap-2 text-xs text-fg-tertiary tabular-nums data-[beat=stalled]:text-warning"
    >
      <span
        key={beat.kind === "live" ? beat.measuredAt : beat.kind}
        aria-hidden
        data-beat-dot=""
        className={cn("size-1.5 shrink-0 rounded-full", DOT[beat.kind], beat.kind === "live" && "beat-pulse")}
      />
      <span className="truncate">{beatText(beat)}</span>
    </span>
  );
}

/**
 * **안내 띠**(스토리 131 · 132 · 133 · 시안 `pr-note`) — 요약 카드와 보기 도구 사이에 선다. 경고 무리의 옅은 면(`wait-soft`) · `radius-ctl` ·
 * 높이 36 이상 · 안쪽 6 8 6 12, 앞에 경고 색 아이콘 14, 글자 13. 멈춤이면 끝에 「다시 읽기」가 선다(아이콘 12 · 글자 — 안쪽은 좌우 9 그대로다, 시안
 * `.at-btn.xs` · restart 03-12c. 앱 버튼의 `data-icon` 갈래는 앞 안쪽을 6으로 줄인다) — 누르면 곧바로 한 번 묻는다(`readSnapshotNow`).
 * 실패하면 멈춤이 남는다. 들어올 때 줄 바뀜으로 선다(`row-in` — 시안 `ra-in`, restart 03-11).
 */
export function SampleNoteBand({ note }: { note: SampleNote }) {
  const client = useQueryClient();
  return (
    <div
      role="status"
      data-sample-note={note.retry ? "stalled" : "unread"}
      className="row-in flex min-h-9 items-center gap-2 rounded-ctl bg-wait-soft py-1.5 pr-2 pl-3 text-chat-meta"
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{note.text}</span>
      {note.retry && (
        <Button variant="secondary" size="xs" onClick={() => void readSnapshotNow(client)}>
          <RefreshCw aria-hidden />
          다시 읽기
        </Button>
      )}
    </div>
  );
}

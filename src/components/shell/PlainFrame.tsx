import { useRef, type ReactNode } from "react";
import { InlineRename } from "@/components/ui/inline-rename";
import { HOTKEYS, pressed } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import type { HeadRename } from "./Frame";
import { ScreenHead } from "./ShellHead";

// **Thread · 첫 화면 · Library가 틀에 건네는 것**(02 구현 스펙 §3 · v1 티켓 07) — 틀은 앱 셸 하나다: 크롬 맨 위 머리 줄(44)과 그 아래 흰 판
// (`AppShell` · `ShellHead`). 이 화면들은 머리 줄에 놓을 것(이름 · 이름 뒤 · 오른쪽 끝)과 판 안에 놓을 것(본문)만 건넨다. 공용 틀(`Frame`)의
// 화면들(Projects · Terminal · Processes · Archive · Settings · Work 화면)은 아직 제 머리 카드를 판 안에 그린다 — 머리 줄로 옮기는 것은 03이다.
//
//   머리 줄의 화면 자리(`ScreenHead`) ─ 이름(있으면 · 그 자리에서 바꾼다) · 이름 뒤(`after`) · 오른쪽 끝(`end`)
//   판 안 ─ 본문 `<main>` — 화면이 건넨 것이 곧장 선다
//
// - **머리 줄의 자리 · 끌기 · 세로선은 셸의 것이다** — 이름이 사이드바 끝을 따라 옮겨 가는 것도 셸이 든다(`ShellHeadRow`). 바꿀 수 있는
//   이름은 포커스를 받는 요소라 Tauri가 끌기에서 스스로 비켜 둔다 — 끄는 자리의 두 번 클릭은 창 키우기라, 두 번 클릭이 이름 바꾸기인
//   이름은 끌면 안 된다. 이름이 없는 새 Thread는 머리 줄 가운데가 빈다(F1-Home 보드).
// - **머리 줄 아래 선은 없다** — 판의 위끝이 경계다. 본문은 제 카드 없이 흰 판에 곧장 선다.
// - **이름은 그 자리에서 바꾼다**(두 번 클릭 · F2) — 공용 틀 머리 카드의 이름과 같은 길이다(`HeadRename` · `InlineRename`).
// - 머리의 모양(이름 14/500 · Work 알약 · 참여자 얼굴 · 카드 토글)은 옛 Thread 머리 줄 그대로 옮겼다 — 06이 Codex 모양으로 바꾼다.

interface PlainFrameProps {
  /** 머리 줄의 이름 — 없으면 머리 줄 가운데가 빈다(새 Thread). */
  title?: { name: string; rename?: HeadRename };
  /** 이름 바로 뒤 — 이은 Work의 알약(v1 티켓 30 · 화면 2 보드 `.wchip`, 이름과 틈 10). */
  after?: ReactNode;
  /** 머리 줄 오른쪽 끝 — 참여자 얼굴(v1 티켓 14). ⋯ · Work 패널 토글(31 · 34)도 여기 선다. */
  end?: ReactNode;
  /** 본문(`<main>`)의 이름(`aria-label`). */
  label: string;
  children: ReactNode;
}

export function PlainFrame({ title, after, end, label, children }: PlainFrameProps) {
  return (
    <>
      {(title || after || end) && (
        <ScreenHead>
          {title && <PlainTitle name={title.name} rename={title.rename} />}
          {after && <div className="ml-2.5 flex min-w-0 items-center">{after}</div>}
          {end && <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2.5">{end}</div>}
        </ScreenHead>
      )}
      {/* 판 안 사이드바 오른쪽의 남는 자리를 다 쓴다(판이 가로 줄이다). */}
      <main aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </main>
    </>
  );
}

/**
 * 머리 줄의 이름 — 14/500 한 줄(보드 `.bar .title`). 바꿀 수 있으면 포커스를 받고 두 번 클릭 · F2가 고치기에 들며, 고치는 동안은 이름
 * 자리에 입력칸이 선다. 키로 끝내면 포커스가 이 이름으로 돌아온다.
 */
function PlainTitle({ name, rename }: { name: string; rename?: HeadRename }) {
  const nameEl = useRef<HTMLSpanElement>(null);
  if (rename?.editing) {
    return (
      <InlineRename
        value={name}
        label={rename.label}
        emptyMeans="revert"
        fit="text"
        onCommit={rename.onCommit}
        onDone={rename.onEnd}
        returnFocus={() => nameEl.current}
        className="-ml-1 h-6 px-1 text-sm font-medium text-fg"
      />
    );
  }
  return (
    <span
      ref={nameEl}
      tabIndex={rename ? 0 : undefined}
      aria-keyshortcuts={rename ? HOTKEYS.rename.aria : undefined}
      onKeyDown={(event) => {
        if (rename && pressed(event, "rename")) {
          event.preventDefault();
          rename.onStart();
        }
      }}
      onDoubleClick={rename?.onStart}
      className={cn("min-w-0 truncate rounded-md text-sm font-medium text-fg", rename && "focus-ring")}
    >
      {name}
    </span>
  );
}

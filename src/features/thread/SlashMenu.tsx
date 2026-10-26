import { useEffect, useRef } from "react";
import type { CommandOption } from "./chips";

// 「/」 메뉴(v1 티켓 05 · 캔버스 Composer 보드 「/ · 명령」) — 입력칸이 「/」로 시작하면 입력창 바로 위에 같은 폭으로 선다. 화면이 하는
// 명령(`/new` 새 Thread)이 먼저이고, Runtime이 보낸 명령이 뒤에 붙는다(구현 스펙 §14). 모양은 보드의 `.pop`(16 반경 · 떠 있는 면)과
// 줄(34 · 명령은 고정폭 13, 설명은 12 `fg-tertiary`)이다. 명령 칸은 보드의 64가 바닥이고 가장 긴 명령만큼 넓어진다 — Runtime 명령은
// 보드의 것보다 길다(`/compact` · `/claude-handoff`). 줄들이 한 격자의 칸을 나눠 써 설명이 한 줄로 맞는다. three-axes 메뉴(`chat/SlashMenu.tsx`)의 규칙 그대로 **포커스는 입력칸에
// 남는다** — 입력칸이 `aria-activedescendant`로 켜진 줄을 가리키고 ↑ · ↓ · Enter · Tab · Esc는 입력칸이 받는다.

/** 메뉴가 찾는 말 — 입력칸이 「/」로 시작하고 아직 띄어 쓰지 않았으면 「/」 뒤의 글자, 아니면 `null`. */
export function slashQuery(draft: string): string | null {
  const typed = /^\/(\S*)$/.exec(draft);
  return typed ? typed[1] : null;
}

const bare = (name: string) => name.replace(/^\$/, "").toLowerCase();

/** 친 글자로 명령을 찾는다 — 그 글자로 시작하는 것을 먼저, 품은 것을 뒤에 둔다. 차례는 준 차례 그대로다. */
export function matchCommands(commands: readonly CommandOption[], query: string): CommandOption[] {
  const typed = query.toLowerCase();
  const keys = (command: CommandOption) => [bare(command.name), ...command.aliases.map(bare)];
  const starts = commands.filter((command) => keys(command).some((key) => key.startsWith(typed)));
  const contains = commands.filter((command) => !starts.includes(command) && keys(command).some((key) => key.includes(typed)));
  return [...starts, ...contains];
}

export const commandText = (command: CommandOption) => (command.name.startsWith("$") ? command.name : `/${command.name}`);

export const optionId = (menuId: string, at: number) => `${menuId}-${at}`;

function SlashMenu({
  id,
  items,
  active,
  onPick,
  onPoint,
}: {
  id: string;
  items: readonly CommandOption[];
  active: number;
  onPick: (command: CommandOption) => void;
  onPoint: (at: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${optionId(id, active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="명령"
      className="absolute inset-x-0 bottom-full z-10 mb-2 grid max-h-[min(320px,50vh)] grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] content-start gap-x-2.5 gap-y-px overflow-y-auto rounded-2xl bg-surface-elevated p-1.5 shadow-prominent scroll-quiet"
    >
      {items.map((command, at) => (
        <div
          key={command.name}
          id={optionId(id, at)}
          role="option"
          aria-selected={at === active}
          aria-label={commandText(command)}
          aria-description={command.description || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (at !== active) onPoint(at);
          }}
          onClick={() => onPick(command)}
          className="col-span-2 grid min-h-8.5 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 text-sm whitespace-nowrap aria-selected:bg-fill-hover"
        >
          <span className="max-w-48 truncate font-mono text-code">{commandText(command)}</span>
          <span className="min-w-0 truncate text-xs text-fg-tertiary">{command.description}</span>
        </div>
      ))}
    </div>
  );
}

export default SlashMenu;

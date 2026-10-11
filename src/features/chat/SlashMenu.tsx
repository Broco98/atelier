import { useEffect, useRef } from "react";
import type { CommandOption } from "./chips";

// 「/」 메뉴(three-axes 티켓 19 · 스토리 33 · 34) — 입력칸이 「/」로 시작하면 입력창 바로 위에 같은 폭으로 선다(캔버스 보드 14 「슬래시
// 명령 메뉴」 · `.cx-menu`). 줄은 엔진이 낸 명령(`available_commands_update`)의 이름과 설명이고, 친 글자로 이름과 별칭을 찾는다.
// 고르면 입력칸이 `/이름 `이 되어 인자를 이어 쓴다.
//
// **포커스는 입력칸에 남는다.** 메뉴 부품(`DropdownMenu`)은 포커스를 가져가 치던 글이 끊기므로 쓰지 않는다 — 입력칸이
// `aria-activedescendant`로 켜진 줄을 가리키고, ↑ · ↓ · Enter · Tab · Esc는 입력칸이 받는다(`Composer`). 줄을 눌러도 입력칸이 포커스를
// 잃지 않는다.

/**
 * 메뉴가 찾는 말 — 입력칸이 「/」로 시작하고 아직 띄어 쓰지 않았으면 「/」 뒤의 글자, 아니면 `null`(메뉴가 서지 않는다). 이름 뒤에
 * 띄어 쓰면 인자를 쓰는 중이라 메뉴가 걷힌다.
 */
export function slashQuery(draft: string): string | null {
  const typed = /^\/(\S*)$/.exec(draft);
  return typed ? typed[1] : null;
}

/** 이름에서 엔진의 표지(Codex 스킬의 `$`)를 뗀 찾기 말. */
const bare = (name: string) => name.replace(/^\$/, "").toLowerCase();

/**
 * 친 글자로 명령을 찾는다 — 이름이나 별칭이 그 글자로 시작하는 것을 먼저, 그 글자를 품은 것을 뒤에 둔다. 차례는 엔진이 준
 * 차례 그대로다. 빈 글자면 다다.
 */
export function matchCommands(commands: readonly CommandOption[], query: string): CommandOption[] {
  const typed = query.toLowerCase();
  const keys = (command: CommandOption) => [bare(command.name), ...command.aliases.map(bare)];
  const starts = commands.filter((command) => keys(command).some((key) => key.startsWith(typed)));
  const contains = commands.filter(
    (command) => !starts.includes(command) && keys(command).some((key) => key.includes(typed)),
  );
  return [...starts, ...contains];
}

/**
 * 명령을 부르는 글 — `/이름`이다. Codex의 스킬은 엔진이 이미 부르는 표지를 붙여 낸다(`$probe-skill`, codex-acp가 `$`를 붙인 이름을
 * 명령으로 보지 않고 모델에게 그대로 넘긴다) — 그 이름 그대로다.
 */
export const commandText = (command: CommandOption) =>
  command.name.startsWith("$") ? command.name : `/${command.name}`;

/** 줄의 id — 입력칸의 `aria-activedescendant`가 가리킨다. */
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
  /** 켜진 줄의 자리. */
  active: number;
  onPick: (command: CommandOption) => void;
  /** 포인터가 그 줄에 올라왔다 — 그 줄이 켜진다. */
  onPoint: (at: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // 켜진 줄이 보이게 굴린다 — 키로 옮겨 상자 밖으로 나가도 따라간다.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${optionId(id, active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="명령"
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[min(320px,50vh)] flex-col gap-0.5 overflow-y-auto rounded-card bg-popover p-1.5 shadow-(--chat-shadow-menu) scroll-quiet"
    >
      <div aria-hidden className="shrink-0 px-2 pt-1.5 pb-0.5 text-caption text-tertiary">
        명령
      </div>
      {items.map((command, at) => (
        <div
          key={command.name}
          id={optionId(id, at)}
          role="option"
          aria-selected={at === active}
          aria-label={commandText(command)}
          aria-description={command.description || undefined}
          // 눌러도 입력칸이 포커스를 잃지 않는다(머리말).
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (at !== active) onPoint(at);
          }}
          onClick={() => onPick(command)}
          className="flex h-[30px] shrink-0 cursor-default items-center gap-2.5 rounded-lg px-2 text-ui leading-[18px] whitespace-nowrap aria-selected:bg-state-2"
        >
          <span className="shrink-0 font-mono text-mono leading-[18px]">{commandText(command)}</span>
          <span className="min-w-0 truncate text-tertiary">{command.description}</span>
        </div>
      ))}
    </div>
  );
}

export default SlashMenu;

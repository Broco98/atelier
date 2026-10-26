import { Fragment, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import type { AgentChoice } from "./mentions";
import { optionId } from "./SlashMenu";

// @ 메뉴(v1 티켓 14 · 캔버스 Composer 보드 「@ · Agent 부르기」) — 입력칸의 커서가 멘션 이름 안에 서면 입력창 바로 위에 같은 폭으로
// 선다. 이 Thread에 있는 Agent → Library → Project 묶음이고(`agentChoices`), 줄은 얼굴 20 · 이름 · `@handle` · 설명 한 줄이다(보드
// `.mi` — 34 · 10 반경 · 설명은 12 `fg-tertiary`로 오른쪽 끝). 깨진 Agent는 흐리게, 설명 자리에 까닭이 서고 고를 수 없다(스토리 71).
// 맨 끝은 「새 Agent 만들기」다 — 새 Thread의 입력창에 Agent 만들기를 맡기는 말을 채운다(v1 티켓 19 · `onCreate`). 동작을 받지
// 못한 입력창에서는 흐린 줄로 자리만 선다.
//
// 「/」 메뉴(`SlashMenu`)와 같은 규칙이다 — **포커스는 입력칸에 남고** 입력칸이 `aria-activedescendant`로 켜진 줄을 가리킨다.
// ↑ · ↓ · Enter · Tab · Esc는 입력칸이 받는다(`ThreadComposer`). 줄의 차례 번호는 `items`의 차례이고, 「새 Agent 만들기」는 그 끝이다.

/** 줄이 고를 수 있나 — 깨진 Agent와 동작이 없는 「새 Agent 만들기」는 지나친다. */
export const pickable = (items: readonly AgentChoice[], at: number, canCreate: boolean): boolean =>
  at < items.length ? items[at].broken === null : canCreate;

function AgentMenu({
  id,
  items,
  active,
  canCreate,
  onPick,
  onCreate,
  onPoint,
}: {
  id: string;
  items: readonly AgentChoice[];
  active: number;
  canCreate: boolean;
  onPick: (agent: AgentChoice) => void;
  onCreate: () => void;
  onPoint: (at: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${optionId(id, active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  const sections = items.reduce<{ section: string; rows: { agent: AgentChoice; at: number }[] }[]>((groups, agent, at) => {
    const tail = groups[groups.length - 1];
    if (tail && tail.section === agent.section) tail.rows.push({ agent, at });
    else groups.push({ section: agent.section, rows: [{ agent, at }] });
    return groups;
  }, []);
  const createAt = items.length;
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="Agent 부르기"
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[min(360px,50vh)] flex-col overflow-y-auto rounded-2xl bg-surface-elevated p-1.5 shadow-prominent scroll-quiet"
    >
      {sections.map(({ section, rows }) => (
        <Fragment key={section}>
          <div role="presentation" className="px-2.5 pt-2 pb-1 text-2xs text-fg-tertiary">
            {section}
          </div>
          <div role="group" aria-label={section} className="flex flex-col gap-px">
            {rows.map(({ agent, at }) => (
              <div
                key={`${agent.section}/${agent.call}`}
                id={optionId(id, at)}
                role="option"
                aria-selected={at === active}
                aria-disabled={agent.broken !== null || undefined}
                aria-label={agent.name}
                aria-description={agent.broken ?? (agent.description || undefined)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (at !== active && agent.broken === null) onPoint(at);
                }}
                onClick={() => {
                  if (agent.broken === null) onPick(agent);
                }}
                className={cn(
                  "flex min-h-8.5 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-sm whitespace-nowrap aria-selected:bg-fill-hover",
                  agent.broken !== null && "opacity-55",
                )}
              >
                <AgentFace handle={agent.handle} avatar={agent.avatar} className="size-5" />
                <span className="max-w-48 shrink-0 truncate">{agent.name}</span>
                {agent.handle !== "host" && <span className="shrink-0 text-xs text-fg-tertiary">@{agent.call}</span>}
                <span className="ml-auto min-w-0 truncate pl-2 text-xs text-fg-tertiary">{agent.broken ?? agent.description}</span>
              </div>
            ))}
          </div>
        </Fragment>
      ))}
      <div className="mt-1 border-t-[0.5px] border-border pt-1">
        <div
          id={optionId(id, createAt)}
          role="option"
          aria-selected={createAt === active}
          aria-disabled={!canCreate || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (createAt !== active && canCreate) onPoint(createAt);
          }}
          onClick={() => {
            if (canCreate) onCreate();
          }}
          className={cn(
            "flex min-h-8.5 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-sm aria-selected:bg-fill-hover",
            // 보드의 끝 줄은 Agent 줄보다 한 단 옅은 글자다(`fg-secondary`). 동작이 없으면 한 단 더 옅다.
            canCreate ? "text-fg-secondary" : "text-fg-tertiary",
          )}
        >
          <Plus className="size-4 text-fg-secondary" aria-hidden />새 Agent 만들기
        </div>
      </div>
    </div>
  );
}

export default AgentMenu;

import type { ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { Bot, ChevronDown, Map as MapIcon, Pencil, Shield, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { chatUiStore, conversationKey } from "./chat-store";
import { currentChoice, type ChipLists, type ChoiceOption } from "./chips";
import { useChangeChoice, useSwitchAgent, type ChoiceChange } from "./hooks";
import type { Agent, Conversation } from "./types";

// 입력창의 칩(three-axes 티켓 19 · 스토리 23 ~ 32) — 에이전트 · 모드 · Codex 「계획」은 왼쪽에, 모델은 보내기 원 앞에 선다(캔버스 보드
// 14 「입력창 — 상태」의 `.cx-cbar`). 칩은 28 알약 · 좌우 8 · 13/18이고, hover와 메뉴가 열린 동안은 켜짐 면(state-3)이다. 목록과
// 지금 값의 원천은 기록이다(`chips.ts`, S15).
//
// **바꾸면 호스트의 명령으로 간다** — 에이전트는 에이전트 바꾸기, 나머지는 모델 · 모드 · 계획 바꾸기다. 값은 그 대화의 것이고 설정의
// 기본값은 그대로다(스토리 31 · 32). 거절은 입력창 아래 글로 선다(`onProblem`).
//
// 메뉴는 포털로 `body`에 선다 — 대화창 범위 토큰(`[data-chat]`)이 닿지 않으므로 메뉴 안은 앱 부품 모양 그대로다(`floating-card` ·
// `menu-row`).

/** 에이전트의 화면 이름 — 칩과 자리 표시 글이 쓴다. */
export const AGENT_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

const AGENTS: readonly Agent[] = ["claude", "codex"];

/** 첫 말 뒤 잠긴 에이전트 칩의 까닭 — 툴팁과 설명이 같은 글이다(구현 스펙 「입력창」). */
const AGENT_LOCKED = "첫 말 뒤에는 바꿀 수 없어요. 다른 에이전트는 +로 열어요";

/** Claude 모델 목록 끝의 한 줄 — 모델을 바꾼 뒤 첫 턴은 캐시를 다시 쓴다(실측 함정 37). */
const CLAUDE_MODEL_NOTE = "바꾼 첫 턴은 캐시를 다시 써서 더 들어요";

/** 칩 하나의 모양(캔버스 `.cx-ctl`). 글자색은 부르는 자리가 준다 — 모드는 한 단 옅다(`.sec`). */
const CHIP =
  "flex h-7 min-w-7 shrink-0 items-center justify-center gap-[5px] rounded-full px-2 text-ui leading-[18px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
/** 누르면 메뉴가 뜨는 칩 — hover와 열린 동안 켜짐 면이다. */
const MENU_CHIP = `${CHIP} hover:bg-state-3 data-[popup-open]:bg-state-3`;

interface ComposerChipsProps {
  work: string;
  conversation: Conversation;
  lists: ChipLists;
  /** 바꾸기가 거절됐다 — 그 글(`null`이면 지운다). */
  onProblem: (problem: string | null) => void;
  /** 모델 칩 뒤 줄 끝에 서는 것 — 입력창의 보내기 원 · 멈추기. */
  end: ReactNode;
}

/**
 * 칩 줄 — 왼쪽 무리(에이전트 · 모드 · 계획)와 오른쪽 무리(모델 칩 · 보내기 원)다. 좁은 작업 패널에서 줄이 넘치면 오른쪽 무리가 다음
 * 줄로 내려가되 오른쪽 끝에 붙는다 — 보내기 원은 늘 입력창의 오른쪽 아래다.
 */
function ComposerChips({ work, conversation, lists, onProblem, end }: ComposerChipsProps) {
  const key = conversationKey(work, conversation.id);
  const chosen = useStore(chatUiStore, (state) => state.chosen[key]);
  const switchAgent = useSwitchAgent();
  const changeChoice = useChangeChoice();

  const change = (next: ChoiceChange) => {
    onProblem(null);
    changeChoice.mutate(
      { work, conversation: conversation.id, change: next },
      { onError: (error) => onProblem(String(error)) },
    );
  };

  const model = currentChoice(lists.engine.model, lists.floor.model, conversation.model, chosen?.model);
  const mode = currentChoice(lists.engine.mode, lists.floor.mode, conversation.mode, chosen?.mode);
  const plan = currentChoice(lists.engine.plan, lists.floor.plan, conversation.plan, chosen?.plan);

  return (
    <>
      <AgentChip
        agent={conversation.agent}
        locked={lists.sent}
        pending={switchAgent.isPending}
        onPick={(agent) => {
          onProblem(null);
          switchAgent.mutate(
            { work, conversation: conversation.id, agent },
            { onError: (error) => onProblem(String(error)) },
          );
        }}
      />
      {lists.modes && (
        <ChoiceChip
          kind="모드"
          options={lists.modes}
          value={mode}
          icon={<ModeIcon mode={mode} />}
          className="text-muted-foreground"
          onPick={(value) => change({ field: "mode", value })}
        />
      )}
      {lists.plannable && (
        <button
          type="button"
          aria-pressed={plan === true}
          onClick={() => change({ field: "plan", value: plan !== true })}
          className={cn(
            CHIP,
            plan === true ? "bg-(--chat-plan) text-(--chat-link)" : "text-foreground hover:bg-state-3",
          )}
        >
          <MapIcon className="size-3.5" strokeWidth={1.8} aria-hidden />
          계획
        </button>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-0.5">
        {lists.models && (
          <ChoiceChip
            kind="모델"
            options={lists.models}
            value={model}
            note={conversation.agent === "claude" ? CLAUDE_MODEL_NOTE : null}
            className="text-foreground"
            onPick={(value) => change({ field: "model", value })}
          />
        )}
        {end}
      </div>
    </>
  );
}

/**
 * 에이전트 칩(스토리 23 · 24) — 첫 말 전에는 Claude Code와 Codex를 바꾸는 메뉴다. 첫 말 뒤에는 잠긴다: 메뉴가 없고(⌄도 없다), 툴팁과
 * 설명이 까닭을 말한다. 툴팁은 `disabled` 버튼에 서지 않으므로 잠김은 `aria-disabled`로 말하고 누름을 받지 않는다.
 */
function AgentChip({
  agent,
  locked,
  pending,
  onPick,
}: {
  agent: Agent;
  locked: boolean;
  pending: boolean;
  onPick: (agent: Agent) => void;
}) {
  const label = AGENT_LABEL[agent];
  const name = `에이전트 ${label}`;
  if (locked) {
    return (
      <Hint
        text={AGENT_LOCKED}
        announce="description"
        type="button"
        aria-label={name}
        aria-disabled
        className={cn(CHIP, "cursor-default text-muted-foreground")}
      >
        <Bot className="size-3.5" strokeWidth={1.8} aria-hidden />
        {label}
      </Hint>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={name} disabled={pending} className={cn(MENU_CHIP, "text-foreground disabled:opacity-40")}>
        <Bot className="size-3.5" strokeWidth={1.8} aria-hidden />
        {label}
        <ChevronDown className="size-3 text-muted-foreground" strokeWidth={1.8} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        <DropdownMenuRadioGroup
          value={agent}
          onValueChange={(next: Agent) => {
            if (next !== agent) onPick(next);
          }}
        >
          {AGENTS.map((one) => (
            <DropdownMenuRadioItem key={one} value={one} label={AGENT_LABEL[one]} aria-label={AGENT_LABEL[one]}>
              <span className="min-w-0 flex-1 truncate">{AGENT_LABEL[one]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 모델 · 모드 칩(스토리 25 · 28 · 29) — 엔진이 낸 목록을 이름 그대로 보이는 라디오 메뉴다. 칩 글자는 지금 값의 이름이고, 목록에
 * 없는 값이면 엔진이 준 값 그대로다. 줄마다 엔진이 준 설명이 이름 아래 한 줄로 선다. `note`는 목록 끝의 안내 한 줄이다.
 */
function ChoiceChip({
  kind,
  options,
  value,
  icon,
  note = null,
  className,
  onPick,
}: {
  kind: "모델" | "모드";
  options: readonly ChoiceOption[];
  value: string | null;
  icon?: ReactNode;
  note?: string | null;
  className: string;
  onPick: (value: string) => void;
}) {
  const shown = value === null ? null : (options.find((option) => option.value === value)?.name ?? value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={shown === null ? kind : `${kind} ${shown}`}
        className={cn(MENU_CHIP, "max-w-56 min-w-0", className)}
      >
        {icon}
        <span className="min-w-0 truncate">{shown ?? kind}</span>
        <ChevronDown className="size-3 text-muted-foreground" strokeWidth={1.8} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align={kind === "모델" ? "end" : "start"} width="layout">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next: string) => {
            if (next !== value) onPick(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              label={option.name}
              aria-label={option.name}
              aria-description={option.description ?? undefined}
              className={option.description ? "h-auto items-start py-[7px]" : undefined}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{option.name}</span>
                {option.description && <span className="truncate text-meta text-tertiary">{option.description}</span>}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {note && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2.5 py-1.5 text-caption text-tertiary">{note}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 모드 칩의 아이콘(캔버스 보드 14) — 묻는 모드는 방패 체크, 알아서 하는 모드는 방패, 편집을 받아들이는 모드는 연필, 계획 모드는
 * 지도다. 모르는 모드는 방패 체크다. 모드 이름은 엔진의 것 그대로라(결정 16) 아이콘만 id로 고른다.
 */
function ModeIcon({ mode }: { mode: string | null }) {
  const Icon =
    mode === "acceptEdits" || mode === "workspace-write"
      ? Pencil
      : mode === "plan"
        ? MapIcon
        : mode === "auto" || mode === "agent" || mode === "agent-full-access" || mode === "dontAsk"
          ? Shield
          : ShieldCheck;
  return <Icon className="size-3.5" strokeWidth={1.8} aria-hidden />;
}

export default ComposerChips;

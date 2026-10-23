import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { AtSign, ChevronDown, ChevronRight, Folder, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { ASK_LEVELS, askLevelOf, chipLabel, EFFORTS, type ChoiceOption } from "./chips";
import HostFace from "./HostFace";
import type { AgentChoice } from "./mentions";
import type { AskLevel } from "./types";

// 입력창의 칩(v1 티켓 05 · 구현 스펙 §14 「입력창 아래 줄」 · 캔버스 Composer 보드). three-axes 칩(`chat/ComposerChips.tsx`)을 옮겨 보드의
// 자리로 나눴다.
// - **모델 · 생각 깊이**는 입력창 안, 보내기 원 앞의 칩 하나다(「Opus · 높음」). 누르면 16 반경 메뉴에 「Claude Code」 모델 목록과
//   「생각 깊이」 칸 줄이 선다. 값은 다음 말을 받을 참여자 Session의 것이다(스토리 33) — 바꾸면 다음 턴부터 든다. 생각 깊이는 턴이 도는
//   동안 바꿀 수 없다(엔진이 거절한다 — 그래서 그동안 잠근다).
// - **아래 줄**은 받는 이 · Work · 물어보는 정도다. **받는 이**는 말의 첫 멘션이 고른 Agent, 없으면 Host다(S9 · v1 티켓 14) — 누르면
//   부를 수 있는 Agent가 서고, 고르면 말 앞의 멘션을 갈아 끼운다(`withRecipient`). Work 칩(31)은 아직 **보이기만 한다** — 누를 것이
//   없으니 단추가 아니고 셰브런도 없다. 이은 Work가 있으면 그 제목이 선다(v1 티켓 30 — Work 만들기 카드로 이어진 뒤).
// - **물어보는 정도**(v1 티켓 23 · 스토리 84 · 보드 「아래 줄 메뉴 · 물어보는 정도」)는 방패 · 지금 정도 이름의 칩이다. 누르면 「언제
//   물어볼까요」 아래 넷이 이름과 설명 한 줄로 서고 고른 것에만 체크가 붙는다. 끝의 「Policy 열기」는 다음 말을 받을 Agent의 파일을
//   Library에서 연다 — 정도보다 먼저 드는 그 Agent의 `ask_before` · `forbid`가 거기 있다. 입력창의 `/policy`도 이 메뉴를 연다.

/** 입력창 안 칩 — 30 · 좌우 9 · 10 반경 · 13/18 `fg-secondary`, hover와 열린 동안 켜짐 면(보드 `.chip`). */
const CHIP =
  "flex h-7.5 shrink-0 items-center gap-1.25 rounded-lg px-2.25 text-chat-meta whitespace-nowrap text-fg-secondary transition-colors outline-none focus-ring";

interface ModelChipProps {
  /** 모델 목록 — Session을 연 적 없으면 null이다. 목록이 없으면 칩은 보이기만 한다. */
  models: readonly ChoiceOption[] | null;
  model: string | null;
  effort: string | null;
  /** 턴이 도는가 — 생각 깊이를 잠근다. */
  running: boolean;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
}

export function ModelChip({ models, model, effort, running, onModel, onEffort }: ModelChipProps) {
  const label = chipLabel(models, model, effort);
  if (!models || models.length === 0) {
    // 새 Thread — 첫 말을 보내야 Host의 Session이 열리고 목록이 선다. 그때까지는 Host 정의 파일의 값을 보이기만 한다.
    return (
      <span aria-label={`모델 ${label}`} className={CHIP}>
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`모델과 생각 깊이 ${label}`}
        className={cn(CHIP, "max-w-56 min-w-0 quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg")}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Claude Code</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={model ?? ""}
            onValueChange={(next: string) => {
              if (next !== model) onModel(next);
            }}
          >
            {models.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} label={option.name} aria-label={option.name}>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{running ? "생각 깊이 · 턴이 끝나면 바꿀 수 있어요" : "생각 깊이"}</DropdownMenuLabel>
          {/* 칸 줄(보드 `.segm`) — 메뉴의 라디오 줄이라 ↑ · ↓로도 지난다. 고른 칸만 떠 있는 흰 면이다. */}
          <MenuPrimitive.RadioGroup
            value={effort ?? ""}
            onValueChange={(next: string) => {
              if (next !== effort) onEffort(next);
            }}
            className="mx-1 mb-1 flex gap-0.5 rounded-lg bg-fill-soft p-0.5"
          >
            {EFFORTS.map((one) => (
              <MenuPrimitive.RadioItem
                key={one.value}
                value={one.value}
                label={one.label}
                disabled={running}
                closeOnClick
                className="flex h-6.5 min-w-0 flex-1 cursor-default items-center justify-center rounded-md px-1 text-xs whitespace-nowrap text-fg-secondary outline-hidden select-none focus:bg-fill-hover data-checked:bg-surface data-checked:text-fg data-checked:shadow-hairline data-disabled:opacity-55"
              >
                {one.label}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 아래 줄 칩 — 28 · 12.5 → `text-xs`(보드 `.tray .chip`). Work · 물어보는 정도는 보이기만 한다(머리말). */
const TRAY_CHIP = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs whitespace-nowrap text-fg-secondary";

/** 받는 이 칩이 보이는 것 — 고른 Agent, 아는 이름이 아닌 멘션, 또는 Host(`null`). */
export type ShownRecipient = { agent: AgentChoice } | { unknown: string } | null;

/** 물어보는 정도 칩이 받는 것 — 지금 정도 · 바꾸기 · 「Policy 열기」, 그리고 `/policy`가 메뉴를 여는 열림 상태. */
export interface AskChoice {
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  /** 「Policy 열기」 — 다음 말을 받을 Agent의 파일로 간다. 없으면 그 줄이 서지 않는다. */
  onOpenPolicy?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 입력창 아래 줄 — 받는 이 · Work · 물어보는 정도(머리말). */
export function ComposerTray({
  recipient,
  agents,
  onRecipient,
  ask,
  work = null,
}: {
  recipient: ShownRecipient;
  /** 받는 이로 고를 수 있는 Agent — 깨진 것은 빠진다. */
  agents: readonly AgentChoice[];
  /** 받는 이를 골랐다 — 부르는 이름, Host면 `null`. */
  onRecipient: (call: string | null) => void;
  ask: AskChoice;
  /** 이은 Work의 제목 — 없으면 「Work 없음」이다. */
  work?: string | null;
}) {
  const callable = agents.filter((agent) => agent.broken === null && agent.call !== "host");
  const value = recipient === null ? HOST_VALUE : "agent" in recipient ? recipient.agent.call : "";
  const label =
    recipient === null ? "Host" : "agent" in recipient ? recipient.agent.name : `@${recipient.unknown}`;
  const sections = [...new Set(callable.map((agent) => agent.section))];
  return (
    <div role="group" aria-label="이 말을 어떻게 보낼지" className="flex flex-wrap items-center gap-0.5 px-2 pt-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`받는 이 ${label}`}
          className={cn(TRAY_CHIP, "max-w-56 min-w-0 quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg focus-ring")}
        >
          {recipient === null ? (
            <HostFace className="size-4" />
          ) : "agent" in recipient ? (
            <AgentFace handle={recipient.agent.handle} avatar={recipient.agent.avatar} className="size-4" />
          ) : (
            <AtSign className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: string) => {
              if (next !== value) onRecipient(next === HOST_VALUE ? null : next);
            }}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>받는 이</DropdownMenuLabel>
              <DropdownMenuRadioItem value={HOST_VALUE} label="Host" aria-label="Host">
                <HostFace className="size-5" />
                <span className="min-w-0 flex-1 truncate">Host</span>
              </DropdownMenuRadioItem>
            </DropdownMenuGroup>
            {sections.map((section) => (
              <DropdownMenuGroup key={section}>
                <DropdownMenuLabel>{section}</DropdownMenuLabel>
                {callable
                  .filter((agent) => agent.section === section)
                  .map((agent) => (
                    <DropdownMenuRadioItem key={agent.call} value={agent.call} label={agent.name} aria-label={agent.name}>
                      <AgentFace handle={agent.handle} avatar={agent.avatar} className="size-5" />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className={TRAY_CHIP} aria-label={work === null ? "Work 없음" : `Work ${work}`}>
        <Folder className="size-3.5" aria-hidden />
        {work ?? "Work 없음"}
      </span>
      <AskChip {...ask} />
    </div>
  );
}

/** 물어보는 정도 칩과 메뉴(보드 「아래 줄 메뉴 · 물어보는 정도」 — 16 반경 메뉴, 고른 것에만 체크, 설명은 한 줄로 끝난다). */
function AskChip({ level, onLevel, onOpenPolicy, open, onOpenChange }: AskChoice) {
  const name = askLevelOf(level)?.name ?? level;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={`물어보는 정도 ${name}`}
        className={cn(TRAY_CHIP, "quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg focus-ring")}
      >
        <Shield className="size-3.5" aria-hidden />
        {name}
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>언제 물어볼까요</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={level}
            onValueChange={(next: AskLevel) => {
              if (next !== level) onLevel(next);
            }}
          >
            {ASK_LEVELS.map((one) => (
              <DropdownMenuRadioItem
                key={one.value}
                value={one.value}
                label={one.name}
                aria-label={one.name}
                aria-description={one.description}
                size="note"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{one.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{one.description}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {onOpenPolicy && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenPolicy} className="text-fg-secondary">
              Policy 열기
              <ChevronRight className="ml-auto size-3.5" aria-hidden />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 받는 이 메뉴에서 Host의 값 — 멘션을 걷는다. 부르는 이름과 겹치지 않는 글자다. */
const HOST_VALUE = "\u0000host";

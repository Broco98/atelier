import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Ban, ChevronDown, ChevronRight, Folder, Plus, Shield } from "lucide-react";
import { agentMarkOf } from "@/components/ui/agent-mark";
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
import { ASK_LEVELS, askLevelOf, chipLabel, EFFORTS, type ChoiceOption } from "./chips";
import { useRecentWorks } from "./hooks";
import type { AskLevel, ThreadLink } from "./types";

// 입력창 안의 칩 셋(v1 티켓 05 · 23 · 31 · 캔버스 Composer 보드 「컴포저 상태」 · 「아래 줄 메뉴」) — 입력칸 아래 줄에 `+` · `@` 다음으로
// Work · 물어보는 정도가, 보내기 원 앞에 모델 · 생각 깊이가 선다. 캔버스는 Work · 물어보는 정도 · 받는 이를 입력창 상자 **밖** 아래 줄에
// 두었지만 사용자가 상자 안으로 넣고 받는 이 칩을 걷기로 정했다(결정.md 「사용자 결정: 입력창 다듬기」) — 받는 이는 말의 첫 멘션이
// 정하고 입력칸의 멘션 칠이 보이며, Agent는 @ 메뉴 하나로 부른다.
// - **모델 · 생각 깊이**(「Opus · 높음」)는 다음 말을 받을 참여자 Session의 값이다(스토리 33). 앞에 Runtime 표시(Claude 마크)가 선다.
//   누르면 16 반경 메뉴에 「Claude Code」 모델 목록과 「생각 깊이」 칸 줄이 선다. 생각 깊이는 턴이 도는 동안 바꿀 수 없다(엔진이
//   거절한다 — 그래서 그동안 잠근다). 목록이 없으면(앉지 않은 Agent를 멘션했다) 보이기만 한다.
// - **Work**(v1 티켓 31 · 스토리 94–96 · Screen-Home 보드 「Work 칩 메뉴」)는 첫 말 전에만 메뉴다 — Work 없이 · 새 Work로 시작 · 최근
//   Work(Thread 수). 첫 말을 보낸 뒤에는 이은 Work를 보이기만 한다(연결을 끊는 길은 없다 — §11). 입력창의 `/work`도 이 메뉴를 연다.
// - **물어보는 정도**(v1 티켓 23 · 스토리 84)는 방패 · 지금 정도 이름의 칩이다. 누르면 「언제 물어볼까요」 아래 넷이 이름과 설명 한 줄로
//   서고 고른 것에만 체크가 붙는다. 끝의 「Policy 열기」는 다음 말을 받을 Agent의 파일을 Library에서 연다 — 정도보다 먼저 드는 그
//   Agent의 `ask_before` · `forbid`가 거기 있다. 입력창의 `/policy`도 이 메뉴를 연다.

/** 입력창 안 칩 — 30 · 좌우 9 · 10 반경 · 13/18 `fg-secondary`(보드 `.chip`). */
const CHIP =
  "flex h-7.5 shrink-0 items-center gap-1.25 rounded-lg px-2.25 text-chat-meta whitespace-nowrap text-fg-secondary transition-colors outline-none focus-ring";
/** 누르면 메뉴가 서는 칩 — hover와 열린 동안 켜짐 면. */
const MENU_CHIP = cn(CHIP, "quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg");
/** 고른 것이 있는 칩(Work를 골랐다) — 옅은 면에 `fg`(Screen-Home 보드 `.chip.on`). */
const PICKED = "bg-fill-soft text-fg";
/** Work 칩의 접근성 이름 — 칩 글자(「Work 없음」 · 「새 Work」 · 제목)만으로는 무엇을 고르는 칩인지 말하지 않는다. */
const workName = (label: string) => `어디서 일할지 ${label}`;

/** 모델 칩 앞의 Runtime 표시 — Claude Code의 마크. 단색이라 칩 글자색을 따른다(`agent-mark.tsx` — 브랜드 색을 박지 않는다). */
const ClaudeMark = agentMarkOf("claude")?.Glyph;

interface ModelChipProps {
  /** 모델 목록 — Session이 알린 것, 열기 전이면 claude가 받는 별칭(`CLAUDE_MODELS`). 없으면 칩은 보이기만 한다. */
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
  const mark = ClaudeMark && <ClaudeMark className="size-3.5 shrink-0" />;
  if (!models || models.length === 0) {
    // 앉지 않은 Agent를 멘션했다 — 그 Agent가 들어와 Session이 열려야 값이 그 Session의 것이 된다. 그때까지는 정의 파일의 값을 보이기만 한다.
    return (
      <span aria-label={`모델 ${label}`} className={CHIP}>
        {mark}
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`모델과 생각 깊이 ${label}`} className={cn(MENU_CHIP, "max-w-56 min-w-0")}>
        {mark}
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

/** Work 칩이 받는 것 — 칩 글자와, 첫 말 전이면 고르기(메뉴)다. */
export interface WorkChoice {
  /** 칩 글자 — 「Work 없음」 · 「새 Work」 · Work 제목(`workHome`). */
  label: string;
  /** 고르기 — 첫 말 전에만 있다. 없으면 칩은 이은 Work를 보이기만 한다. */
  picking?: {
    link: ThreadLink;
    /** 골랐다 — 최근 Work면 그 제목도 함께 온다(부제 · 입력창 안내가 쓴다). */
    onPick: (link: ThreadLink, title: string | null) => void;
  };
}

/** Work 칩 — 첫 말 전에는 메뉴, 그 뒤에는 이은 Work를 보이기만 한다. 메뉴의 열림은 `/work`도 연다. */
export function WorkChip({
  label,
  picking,
  open,
  onOpenChange,
}: WorkChoice & { open: boolean; onOpenChange: (open: boolean) => void }) {
  // 칩 줄이 좁으면(넓힌 카드 곁의 대화 480 — v1 티켓 35) 이 칩만 줄어 제목이 말줄임으로 끊긴다 — 칩의 `shrink-0`을 푼다.
  if (!picking) {
    return (
      <span aria-label={workName(label)} className={cn(CHIP, "min-w-0 shrink")}>
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-44 min-w-0 truncate">{label}</span>
      </span>
    );
  }
  return <WorkPicker label={label} picking={picking} open={open} onOpenChange={onOpenChange} />;
}

/** 메뉴 고르기의 값 — Work 없이 · 새 Work로 시작 · 그 Work. slug와 겹치지 않는 머리를 단다. */
const valueOf = (link: ThreadLink): string => (link.kind === "work" ? `work:${link.slug}` : link.kind);

/** Work 칩 메뉴(Screen-Home 보드 「Work 칩 메뉴」) — 고른 것에만 체크, 최근 Work는 그 Work에 이은 Thread 수를 단다. */
function WorkPicker({
  label,
  picking,
  open,
  onOpenChange,
}: Required<WorkChoice> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const recent = useRecentWorks();
  const { link, onPick } = picking;
  const value = valueOf(link);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={workName(label)}
        className={cn(MENU_CHIP, "min-w-0 shrink", link.kind !== "no-work" && PICKED)}
      >
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-44 min-w-0 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: string) => {
            if (next === value) return;
            if (next === "no-work" || next === "new-work") return onPick({ kind: next }, null);
            const work = recent.find((one) => valueOf({ kind: "work", slug: one.slug }) === next);
            if (work) onPick({ kind: "work", slug: work.slug }, work.title);
          }}
        >
          <DropdownMenuRadioItem
            value="no-work"
            label="Work 없이"
            aria-label="Work 없이"
            aria-description="필요해지면 Host가 만들어요"
            size="note"
          >
            <Ban className="mt-0.5" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">Work 없이</span>
              <span className="truncate text-xs text-fg-tertiary">필요해지면 Host가 만들어요</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="new-work"
            label="새 Work로 시작"
            aria-label="새 Work로 시작"
            aria-description="첫 메시지로 Host가 Work를 만들어요"
            size="note"
          >
            <Plus className="mt-0.5" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">새 Work로 시작</span>
              <span className="truncate text-xs text-fg-tertiary">첫 메시지로 Host가 Work를 만들어요</span>
            </span>
          </DropdownMenuRadioItem>
          {recent.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>최근 Work</DropdownMenuLabel>
                {recent.map((work) => (
                  <DropdownMenuRadioItem
                    key={work.slug}
                    value={valueOf({ kind: "work", slug: work.slug })}
                    label={work.title}
                    aria-label={work.title}
                    aria-description={`Thread ${work.threads}개`}
                  >
                    <Folder aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{work.title}</span>
                    <span className="shrink-0 text-xs text-fg-tertiary">Thread {work.threads}개</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 물어보는 정도 칩이 받는 것 — 지금 정도 · 바꾸기 · 「Policy 열기」, 그리고 `/policy`가 메뉴를 여는 열림 상태. */
export interface AskChoice {
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  /** 「Policy 열기」 — 다음 말을 받을 Agent의 파일로 간다. 없으면 그 줄이 서지 않는다. */
  onOpenPolicy?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 물어보는 정도 칩과 메뉴(보드 「아래 줄 메뉴 · 물어보는 정도」 — 16 반경 메뉴, 고른 것에만 체크, 설명은 한 줄로 끝난다). */
export function AskChip({ level, onLevel, onOpenPolicy, open, onOpenChange }: AskChoice) {
  const name = askLevelOf(level)?.name ?? level;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={`물어보는 정도 ${name}`} className={MENU_CHIP}>
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

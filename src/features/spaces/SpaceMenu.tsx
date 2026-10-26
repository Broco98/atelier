import { useNavigate } from "@tanstack/react-router";
import { Layers, Settings, SquarePen, X } from "lucide-react";
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
import { CrumbSlash } from "@/components/catalog/DetailParts";
import { useProjects } from "@/features/projects/hooks";
import type { WorkView } from "@/features/works/types";
import { useSetSpace, useSpaces } from "./hooks";
import { HOST_MAKE, spaceMenu, spaceName } from "./space-view";

// **Space 메뉴**(03 구현 스펙 §5 · §10 · 시안 F4-WorkSpaced · F4-WorkNoSpace · F4-KitComposer) — Work 화면 머리 줄의 흐린 Space가 열고,
// 트레이의 Space 칩(06)이 같은 몸(`SpaceMenuItems`)을 연다. 줄은 순수 함수가 짓는다(`spaceMenu`).
//
//   Space 빼기 · 등록된 Project 3개를 모두 읽어요         ← Space가 없으면 「Space 없음」 ✓ · Space 칩은 늘 「Space 없음 · … 읽기」
//   ──
//   Space — 고르면 그 안의 Project만 읽어요
//   ◇ 결제 서비스 · web-app · api-server            ✓   ← 문제 있는 Space는 이름 뒤 「문제 있음」
//   ──
//   ⚙ Space 관리                            메뉴 › Space
//
// - 하나도 없으면 목록 자리에 「아직 Space가 없어요」 · 「Host와 Space 만들기」(첫 화면을 「Work 없이 대화」와 입력 글로 연다 — §14 S16)다.
// - 줄은 시안 `.pmenu .mi2`(min 32 · 13.5/19 · 곁말 12/16)를 앱의 두 줄 항목(`size="note"`)이 그린다 — 폭은 내용을 따르되 300부터(`note`).
// - 고른 것은 부르는 쪽이 적는다(`onPick` — Work면 그 Work, Space 칩이면 Thread · 입력창). 같은 것을 다시 고르면 아무것도 하지 않는다.

/** 「지금 Space 없음」의 라디오 값 — slug와 겹치지 않는다. */
const NONE = "\u0000none";

/**
 * Space 메뉴의 몸 — 메뉴 카드(`DropdownMenuContent width="note"`) 안에 선다. `current`는 지금 이은 Space의 slug, `place`는 여는 자리다(맨 위 줄이
 * 갈린다 — `spaceMenu`).
 */
export function SpaceMenuItems({
  current,
  onPick,
  place = "work",
}: {
  current: string | null;
  onPick: (space: string | null) => void;
  place?: "work" | "chip";
}) {
  const { data: spaces = [] } = useSpaces();
  const { data: projects = [] } = useProjects();
  const navigate = useNavigate();
  const menu = spaceMenu(spaces, current, projects.length, place);
  const value = menu.rows?.find((row) => row.current)?.slug ?? NONE;
  const note = <span className="truncate text-xs text-fg-tertiary">{menu.top.note}</span>;
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(next: string) => {
        if (next !== value) onPick(next === NONE ? null : next);
      }}
    >
      {/* 줄 이름은 머리 글자만이다 — 곁말은 설명으로 따로 읽힌다(아래 Space 줄 · Work 칩의 스위치와 같다). */}
      {menu.top.kind === "none" ? (
        <DropdownMenuRadioItem
          value={NONE}
          label={menu.top.label}
          aria-label={menu.top.label}
          aria-description={menu.top.note}
          size="note"
        >
          <X className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{menu.top.label}</span>
            {note}
          </span>
        </DropdownMenuRadioItem>
      ) : (
        <DropdownMenuItem
          aria-label={menu.top.label}
          aria-description={menu.top.note}
          size="note"
          onClick={() => onPick(null)}
        >
          <X className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{menu.top.label}</span>
            {note}
          </span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      {menu.rows ? (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Space — 고르면 그 안의 Project만 읽어요</DropdownMenuLabel>
            {menu.rows.map((row) => (
              <DropdownMenuRadioItem
                key={row.slug}
                value={row.slug}
                label={row.name}
                aria-label={row.troubled ? `${row.name} 문제 있음` : row.name}
                aria-description={row.projects}
                size="note"
              >
                <Layers className="mt-0.5" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{row.name}</span>
                    {row.troubled && <span className="shrink-0 text-xs text-fg-tertiary">문제 있음</span>}
                  </span>
                  <span className="truncate text-xs text-fg-tertiary">{row.projects}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem aria-label="Space 관리" aria-description="메뉴 › Space" onClick={() => void navigate({ to: "/spaces" })}>
            <Settings aria-hidden />
            Space 관리
            <span className="ml-auto pl-3 text-xs text-fg-tertiary">메뉴 › Space</span>
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuGroup>
          <DropdownMenuLabel>아직 Space가 없어요</DropdownMenuLabel>
          <DropdownMenuItem
            size="note"
            aria-label="Host와 Space 만들기"
            aria-description="Host가 Project를 읽고 초안을 내요"
            onClick={() => void navigate({ to: "/", search: HOST_MAKE })}
          >
            <SquarePen className="mt-0.5" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">Host와 Space 만들기</span>
              <span className="truncate text-xs text-fg-tertiary">Host가 Project를 읽고 초안을 내요</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}
    </DropdownMenuRadioGroup>
  );
}

/**
 * Work 화면 머리 줄 이름 앞의 Space(§10 · 시안 F4-KitChat 「Work 화면 · Space 있음」) — 「흐린 Space / Work 이름」, Space가 없으면 흐린
 * 「Space 없음」이다. 누르면 Space 메뉴가 열리고, 고르면 그 Work의 Space가 바뀐다 — 그 Work의 Thread마다 Space 줄이 선다(S9). 글자는
 * 머리 줄의 흐린 글자(`fg-titlebar` — 시안 `.muted` #898a8b)이고 사이는 8이다(시안 `.tb-c` gap 8). Space 목록을 아직 못 읽었으면 slug다.
 */
export function WorkSpaceCrumb({ work }: { work: Pick<WorkView, "slug" | "space"> }) {
  const { data: spaces } = useSpaces();
  const setSpace = useSetSpace();
  const linked = work.space ?? null;
  const found = spaces?.find((one) => one.slug === linked);
  const label = found ? spaceName(found) : linked && !spaces ? linked : "Space 없음";
  return (
    <span className="flex shrink-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-slot="work-space"
          aria-label={found ? `Space: ${label}` : "Space: 없음"}
          className="max-w-60 truncate rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring data-popup-open:text-fg"
        >
          {label}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" sideOffset={8} alignOffset={-10} width="note">
          <SpaceMenuItems
            current={linked}
            onPick={(space) => setSpace.mutate({ target: { work: work.slug }, space })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <CrumbSlash />
    </span>
  );
}

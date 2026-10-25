import { useRef, useState } from "react";
import { createLucideIcon, Folder, MoreHorizontal, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { HEAD_GLYPH, headButton } from "@/components/shell/ShellHead";
import { useWorks } from "@/features/works/hooks";
import { useArchivedWork } from "./SummaryCard";

// **Thread 화면의 머리 줄**(02 구현 스펙 §6 · 캔버스 v35 Screen-Live 머리 줄 · Diff-Frame 「머리 줄」 줄) — 화면은 이 조각들을 머리 줄
// 화면 자리로 보낸다(`PlainFrame`의 `lead` · `end` — 포털, `ShellHead`). Codex 크롬 줄 그대로다.
//
//   [폴더 · Work 이름 ›](이은 Work만)  Thread 이름(14/500 · 그 자리에서 바꾼다) ············  […] [요약 고정]
//   [흐린 Space /](Work 없는 Thread에 Space가 있으면 — 03 §10)
//
// - **걷은 것**: 옛 Work 알약(브랜치) · 참여자 얼굴(S14 — 참여자는 본문 이름 줄 · @ 메뉴가 말한다) · v1 카드 토글(요약 고정 토글이 그
//   자리를 잇는다).
// - **시안의 머리 줄 Work 탭은 짓지 않는다** — Work 화면 몫이다(스펙 §6). 머리 줄에는 이름만 선다.

/**
 * 머리 줄 Thread 이름 앞의 Work(02 §6 · S13) — 폴더 14 · Work 이름 14/400 `fg-titlebar`(#898a8b), 그 뒤 「›」. Work 이름이 누르는 자리이고
 * 누르면 요약 카드가 열린다(옛 Work 알약의 일 — 브랜치 · 알약 면은 걷었다). 「›」는 그림이라 이름에 들지 않는다. 틈은 시안 `.tb-c`의 8이다.
 * 이름이 길면 Thread 이름과 함께 줄어 말줄임이 된다.
 */
export function WorkCrumb({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label={`Work 열기: ${title}`}
        onClick={onOpen}
        className="flex min-w-0 items-center gap-2 rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring"
      >
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <span aria-hidden="true" className="shrink-0 text-sm text-fg-titlebar">
        ›
      </span>
    </>
  );
}

/**
 * Work 없는 Thread의 머리 줄 이름 앞 Space(03 §10 · F4-KitChat 「Work 없음 · Space 있음」) — 「흐린 Space / Thread 이름」. 흐린 Space를 누르면 그
 * Space 상세로 간다. 글자 · 사이는 Work 화면 머리 줄의 Space(`WorkSpaceCrumb`)와 같다 — `fg-titlebar` · 사이 8 · 「/」는 그림이라 이름에 들지
 * 않는다. Space가 없으면 서지 않는다(이름만 — `headSpace`).
 */
export function SpaceCrumb({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label={`Space 열기: ${name}`}
        onClick={onOpen}
        className="min-w-0 truncate rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring"
      >
        {name}
      </button>
      <span aria-hidden="true" className="shrink-0 text-sm text-fg-titlebar">
        /
      </span>
    </>
  );
}

/**
 * 머리 줄 이름 앞에 서는 그 Thread의 Work — 이름은 목록의 제목이고, 아직 목록에 없으면(방금 만든 Work) slug다. 보관된 Work는 보관
 * 목록의 제목이다(v1 티켓 38).
 */
export function HeadWork({ slug, archived, onOpen }: { slug: string; archived: boolean; onOpen: () => void }) {
  const { data: works } = useWorks();
  const shelved = useArchivedWork(archived ? slug : null);
  const title = works?.find((one) => one.slug === slug)?.title || shelved?.title || slug;
  return <WorkCrumb title={title} onOpen={onOpen} />;
}

/**
 * **대상 메뉴 「Thread」의 정의 — 한 자리다**(02 S15 · 결정 「06 · Thread 대상 메뉴」). 지금 사이드바 Thread 줄에는 대상 메뉴가 없고,
 * Thread에 할 수 있는 일은 이름 바꾸기 하나다 — 그래서 항목은 「이름 바꾸기」 하나다. 머리 줄 「…」(`ThreadMenu`)가 이것을 편다.
 * 항목은 ⋯ 메뉴와 우클릭 메뉴가 함께 쓰는 부품이라(`context-menu.tsx` 머리말) 사이드바 줄에 우클릭 메뉴로 달면 같은 줄이 선다. 훅이
 * 없다 — 상태를 쥘 수 없는 자리(사이드바 줄)에서도 펼 수 있게(work 메뉴 `WorkMenuItems`와 같은 꼴).
 *
 * - 「이름 바꾸기」는 그 이름 자리(머리 줄 Thread 이름)를 입력칸으로 바꾼다 — 창이 뜨지 않는다. 단축키 칸은 그 이름에 포커스를 두고
 *   누르는 F2다.
 * - **지금 못 하는 칸은 흐리다**(`rename`이 `null` — 읽기만 된 Thread, v1 티켓 38). 숨기지 않는다(work 메뉴와 같은 규칙).
 */
export function ThreadMenuItems({ rename }: { rename: (() => void) | null }) {
  return (
    <DropdownMenuItem onClick={rename ?? undefined} disabled={rename === null} shortcut="rename">
      <Pencil />
      <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
    </DropdownMenuItem>
  );
}

/**
 * 머리 줄 오른쪽의 「…」(02 §6 · 시안 Screen-Live — 28 · `radius-lg`, 글리프 16 `fg-titlebar`) — 이 Thread의 대상 메뉴(`ThreadMenuItems`)를
 * 연다. 열린 동안은 hover와 같은 면이다. 여닫이 · 줄 옮기기 · Esc · 바깥 누르기는 메뉴 부품이 한다(work 메뉴 ⋯와 같다). 모양은 머리 줄의
 * 아이콘 단추 한 벌이다(`ShellHead`의 `headButton` — 공용 틀 화면의 ⋯ · 분할 · 패널 토글도 같은 것을 쓴다).
 *
 * **「이름 바꾸기」로 닫히면 포커스를 「…」로 돌리지 않는다**(`finalFocus`) — 머리 줄 이름 자리에 막 선 입력칸이 포커스를 받는데,
 * 「…」로 돌아가면 입력칸이 곧바로 blur되어 「다른 곳 = 저장」으로 닫힌다(work 메뉴 ⋯와 같은 까닭 — 구현 노트 Q7). 그 밖의 닫힘은
 * 부품의 기본값이 「…」로 돌린다.
 */
export function ThreadMenu({ rename }: { rename: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const renamed = useRef(false);
  const start =
    rename &&
    (() => {
      renamed.current = true;
      rename();
    });
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint
        text="Thread 메뉴"
        announce="name"
        render={
          <DropdownMenuTrigger className={headButton(open ? "open" : "rest")} />
        }
      >
        <MoreHorizontal className={HEAD_GLYPH} />
      </Hint>
      <DropdownMenuContent
        align="end"
        aria-label="Thread 메뉴"
        finalFocus={() => {
          if (!renamed.current) return true;
          renamed.current = false;
          return false;
        }}
      >
        <ThreadMenuItems rename={start} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 요약 글리프 — 시안 Screen-Live 머리 줄 토글의 그림(16칸: 원 둘 (4.5, 5) · (4.5, 11) r 1.7 + 줄 둘 8.5 → 13.5)을 lucide 24칸으로 1.5배
 * 옮겼다. lucide에 같은 모양이 없다. lucide 아이콘으로 지어 선 굵기는 앱 기본(`LucideProvider` — 16에서 1.5)을 그대로 받는다.
 */
export const SummaryGlyph = createLucideIcon("summary", [
  ["circle", { cx: "6.75", cy: "7.5", r: "2.55", key: "top" }],
  ["circle", { cx: "6.75", cy: "16.5", r: "2.55", key: "bottom" }],
  ["path", { d: "M12.75 7.5h7.5", key: "top-line" }],
  ["path", { d: "M12.75 16.5h7.5", key: "bottom-line" }],
]);

/**
 * 머리 줄 오른쪽 끝의 요약 고정 토글(02 §6 · 시안 Screen-Live `aria-label="요약 고정"`) — 28 · `radius-lg`, 글리프 16 `fg-titlebar`. 켜지면
 * 바탕이 #ebebec(`fill-toggle-on`)이고 글리프가 `fg`로 진해지며, 켜진 채 hover해도 면이 그대로다(시안 `sumBg` · `sumColor`). 이름은 할 일
 * 하나이고 켬/끔은 `aria-pressed`가 말한다.
 *
 * 요약 카드(02 §7 · `SummaryCard`)를 여닫는다 — Work 없는 Thread에도 선다. 첫 말 전의 새 Thread와 지워진 Work의 Thread에는 카드가
 * 없어 서지 않는다(부르는 쪽이 가린다 — S23).
 *
 * 맨 버튼이라 Tab 정류장임을 `tabIndex`로 명시한다(02 코드 리뷰 C1) — macOS WebKit의 Tab은 `tabindex` 없는 맨 버튼에 서지 않는다
 * (`@/lib/roving` 머리말). 「…」(메뉴 트리거)는 0을 스스로 단다.
 */
export function SummaryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Hint
      text="요약 고정"
      announce="name"
      type="button"
      aria-pressed={open}
      onClick={onToggle}
      tabIndex={0}
      className={headButton(open ? "on" : "rest")}
    >
      <SummaryGlyph className={HEAD_GLYPH} />
    </Hint>
  );
}

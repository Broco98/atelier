import { useRef, useState } from "react";
import { createLucideIcon, Folder, MoreHorizontal, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { HEAD_CRUMB, HEAD_GLYPH, headButton } from "@/components/shell/ShellHead";
import { cn } from "@/lib/utils";
import { useWorks } from "@/features/works/hooks";
import { useArchivedWork } from "./SummaryCard";

// **Thread 화면의 머리 줄**(02 구현 스펙 §6 · 캔버스 v35 Screen-Live 머리 줄 · Diff-Frame 「머리 줄」 줄) — 화면은 이 조각들을 머리 줄
// 화면 자리로 보낸다(`PlainFrame`의 `lead` · `end` — 포털, `ShellHead`). Codex 크롬 줄 그대로다.
//
//   │ [폴더 · Work 이름 ›](이은 Work만)  Thread 이름(14/500 · 그 자리에서 바꾼다) […] ············  [요약 카드]
//   │ [흐린 Service /](Work 없는 Thread에 Service가 있으면 — 03 §10)
//   └ 셸 컨트롤 뒤 세로선(`ShellHead`)
//
// - **탭 줄이 없는 채팅의 머리다**(restart 02a-7 · 시안 MainLoose · Shell 「어디에 서나」) — 작업공간 밖 채팅과 읽기만 되는 채팅만 이 머리를
//   쓴다. 작업공간의 채팅은 탭이 이름과 ⋯를 맡는다(02a-5).
// - **「…」는 이름 바로 뒤다**(시안 `.ra-crumb` 뒤 `.ra-tbtn`) — 한때 오른쪽 끝 요약 단추 앞이었다.
// - **걷은 것**: 옛 Work 알약(브랜치) · v1 카드 토글(요약 단추가 그
//   자리를 잇는다).

/**
 * 머리 줄 Thread 이름 앞의 Work(02 §6 · S13) — 폴더 14 · Work 이름, 그 뒤 「›」. 글자는 머리 줄의 흐린 앞 자리(`HEAD_CRUMB` — 13/18
 * `fg-tertiary`, restart 03-12a)다. Work 이름이 누르는 자리이고 누르면 요약 카드가 열린다(옛 Work 알약의 일 — 브랜치 · 알약 면은 걷었다).
 * 「›」는 그림이라 이름에 들지 않는다. 폴더와 이름은 6, 「›」는 한 칸(4)이다.
 * 이름이 길면 Thread 이름과 함께 줄어 말줄임이 된다.
 */
export function WorkCrumb({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        tabIndex={0}
        aria-label={`작업공간 열기: ${title}`}
        onClick={onOpen}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-md whitespace-nowrap transition-colors hover:text-fg focus-ring",
          HEAD_CRUMB,
        )}
      >
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <span aria-hidden="true" className={cn("-ml-0.5 shrink-0", HEAD_CRUMB)}>
        ›
      </span>
    </>
  );
}

/**
 * Work 없는 Thread의 머리 줄 이름 앞 Service(03 §10 · F4-KitChat 「작업공간 없음 · Service 있음」) — 「흐린 Service / 채팅 이름」. 흐린 Service를 누르면 그
 * Service 상세로 간다. 글자 · 사이는 Work 화면 머리 줄의 Service(`WorkServiceCrumb`)와 같다 — `HEAD_CRUMB` · 「/」는 한 칸 · 그림이라 이름에 들지
 * 않는다. Service가 없으면 서지 않는다(이름만 — `headService`).
 */
export function ServiceCrumb({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        tabIndex={0}
        aria-label={`Service 열기: ${name}`}
        onClick={onOpen}
        className={cn("min-w-0 truncate rounded-md whitespace-nowrap transition-colors hover:text-fg focus-ring", HEAD_CRUMB)}
      >
        {name}
      </button>
      <span aria-hidden="true" className={cn("-ml-0.5 shrink-0", HEAD_CRUMB)}>
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
 * **대상 메뉴 「채팅」의 정의 — 한 자리다**(02 S15 · 결정 「06 · 채팅 대상 메뉴」). 지금 사이드바 Thread 줄에는 대상 메뉴가 없고,
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
 * 머리 줄 이름 바로 뒤의 「…」(02 §6 · restart 02a-7 시안 MainLoose — 28 · 둥글기 4, 글리프 15 `fg-secondary`) — 이 Thread의 대상 메뉴(`ThreadMenuItems`)를
 * 연다. 열린 동안은 hover와 같은 면이다. 여닫이 · 줄 옮기기 · Esc · 바깥 누르기는 메뉴 부품이 한다(work 메뉴 ⋯와 같다). 모양은 머리 줄의
 * 아이콘 단추 한 벌이다(`ShellHead`의 `headButton` — 공용 틀 화면의 ⋯ · 패널 토글도 같은 것을 쓴다).
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
        text="채팅 메뉴"
        announce="name"
        render={
          <DropdownMenuTrigger className={headButton(open ? "open" : "rest")} />
        }
      >
        <MoreHorizontal className={HEAD_GLYPH} />
      </Hint>
      <DropdownMenuContent
        align="end"
        aria-label="채팅 메뉴"
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
 * 머리 줄 오른쪽 끝의 요약 단추(02 §6 · 시안 Main · MainLoose `aria-label="요약 카드"` — restart 02a-9가 이름을 「요약 고정」에서 「요약 카드」로
 * 바꿨다, SummarySheet 규격) — 28 · 둥글기 4(`.ra-tbtn`), 글리프 15 `fg-secondary`. 켜지면
 * 바탕이 고른 면(`fill-selected`)이고 글리프가 `fg`로 진해지며, 켜진 채 hover해도 면이 그대로다(시안 `.ra-tbtn[aria-pressed="true"]`). 이름은 할 일
 * 하나이고 켬/끔은 `aria-pressed`가 말한다.
 *
 * 요약 카드(02 §7 · `SummaryCard`)를 여닫는다 — 오른쪽 자리를 `summary`로 세우거나 걷는다(`right-place.ts`). 작업공간의 채팅 탭은 작업공간
 * 화면의 창 머리에, 탭 줄이 없는 채팅(작업공간 밖 · 보관)은 채팅 화면의 창 머리에 선다. Work 없는 Thread에도 선다. 첫 말 전의 새 Thread와
 * 지워진 Work의 Thread에는 카드가 없어 서지 않는다(부르는 쪽이 가린다 — S23).
 *
 * 맨 버튼이라 Tab 정류장임을 `tabIndex`로 명시한다(02 코드 리뷰 C1) — macOS WebKit의 Tab은 `tabindex` 없는 맨 버튼에 서지 않는다
 * (`@/lib/roving` 머리말). 「…」(메뉴 트리거)는 0을 스스로 단다.
 */
export function SummaryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Hint
      text="요약 카드"
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

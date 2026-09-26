import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { Dialog, DialogOverlay, DialogPopup, DialogPortal } from "@/components/ui/dialog";
import { createFirstFrameGuard } from "@/components/ui/first-frame-guard";
import { Input } from "@/components/ui/input";
import { navigateGuardingSettings } from "@/features/settings/navigate-guarding-settings";
import { cn } from "@/lib/utils";
import type { Mode } from "@/mode";
import { itemNameOf } from "@/features/works/work-sections";
import { destinationIcon, destinationLabel } from "./destinations";
import { useSearchHits } from "./hooks";
import { hitTarget } from "./hit-target";
import type { SearchHit } from "./types";

/**
 * ⌘K로, 셸 컨트롤 행의 검색 버튼으로, 또는 `View ▸ Search` 메뉴로 여는 검색 팔레트.
 * **여는 자리는 그래도 하나다** — 버튼도 메뉴도 키 리스너와 같은 state를 켠다
 * (`AppShell.tsx`의 `ShellControls` 호출부).
 *
 * **바깥은 Dialog다**(결정 10) — 창(`dialog`)으로 읽히고, 포커스를 가두고, 닫히면 열기 전 자리로
 * 포커스를 돌려주는 것은 Base UI가 한다. 모양(자리 12vh · 폭 560px · 떠 있는 카드)은 부품 파일의
 * `palette` 변형이 든다(`components/ui/dialog.tsx`). **목록은 우리 listbox 그대로다** — 순서와
 * 묶음은 코어가 정하고, 입력칸이 켜진 줄을 `aria-activedescendant`로 가리킨다.
 *
 * **여는 키(⌘K)의 판정은 여기 없다** — `shell-registry.ts`의 `searchHotkey`가 든다. 그 키가
 * **셸을 지나와야** 하고, 셸이 그것을 타이핑하지 않는다는 것을 정하는 자리가 거기이기
 * 때문이다. 그 함수를 부르고 확인 창을 보는 자리는 앱 셸(`AppShell.tsx`)이다.
 *
 * **터미널 스토어를 import하지 않는다.** 하면 `@xterm/*`와 그 CSS가 따라 들어와 이 파일의
 * 정적 마크업 검사가 서지 못한다(SearchPalette.test.tsx가 그 계약을 센다) — 사이드바 목록이
 * 같은 이유로 셸 개수를 슬롯으로 받는 그 자리와 같다.
 *
 * 치면 좁혀진다. **맞추는 규칙은 코어에 있다**(결정 15) — 여기는 친 것을 그대로 넘기고 받은
 * 것을 순서대로 그린다. **층 순서도 코어의 것이다**: 목적지 → 작업 → 프로젝트 → 문서 → 본문으로
 * 와서 갈래가 안 흩어지므로, 구획 머리는 갈래가 바뀌는 자리에서 한 줄 내면 된다.
 *
 * **프리뷰 패널은 없다**(결정 6). 노션의 오른쪽 프리뷰는 **제목**을 찾는 검색이라 「이 페이지가
 * 맞나」를 답해야 해서 있는 것인데, 여기는 본문 전문검색이라 **매치된 줄 자체가 그 답**이다.
 * 그리고 spec 문서에는 mermaid가 흔해서, 프리뷰는 방향키로 훑을 때마다 다이어그램을 다시
 * 그린다 — 프리뷰를 없앤 이유가 「훑는 것이 고르는 것보다 비싸면 안 된다」였다. 그 계약을
 * 소스 스캔이 센다(SearchPalette.test.tsx): **문서를 그리는 모듈의 이름은 주석에도 안 적는다.**
 */

/**
 * 구획 머리. **사이드바 목록과 같은 계통의 한국어다**(결정 17) — 이 팔레트가 나열하는 것이
 * 사이드바가 나열하는 것과 같은 것들이라, spec 트리의 대문자 영어(`Iterations`·`Documents`)를
 * 따르지 않는다. 부수 효과가 하나 더 있다: 목적지 라벨 `Projects`가 **목적지이면서 그룹
 * 머리이기도 한** 자리가 생기지 않는다.
 */
function groupNameOf(mode: Mode, kind: SearchHit["kind"]): string {
  // **항목 갈래만 세계를 탄다.** 나머지 넷은 두 세계가 같은 말로 부르는 것들이고
  // (`프로젝트`는 Atelier에서만 결과로 올라온다 — 결정 17), 항목 하나만 Atelier에서 `작업`
  // Maison에서 `Room`이다. 그 낱말의 정본은 목록의 어휘 표다(`work-sections.ts`) —
  // 여기 리터럴로 다시 적으면 사이드바는 Room 어휘인데 팔레트 구획 머리만 「작업」인,
  // **한 화면에 두 세계의 말이 서는** 판이 난다.
  const table: Record<SearchHit["kind"], string> = {
    destination: "가는 곳",
    work: itemNameOf(mode),
    project: "프로젝트",
    doc: "문서",
    text: "본문",
  };
  return table[kind];
}

/**
 * 줄에 서는 말. **갈래마다 다르다** — 코어가 태그를 달아 보내는 이유가 이것이다.
 * 목적지의 라벨은 프런트 것이라(결정 21) 코어가 준 `key`로 여기서 되찾는다.
 *
 * **되찾는 표가 세계마다 다르다** — 그래서 이 함수만 모드를 받는다. 나머지 넷은 코어가 준
 * 말을 그대로 세우므로 세계를 알 필요가 없다.
 */
function rowText(mode: Mode, hit: SearchHit): { name: string; detail?: string; snippet?: string } {
  switch (hit.kind) {
    case "destination":
      return { name: destinationLabel(mode, hit.key) };
    case "work":
      return { name: hit.title };
    case "project":
      return { name: hit.name };
    case "doc":
      // work 제목과 경로가 **함께** 선다(결정 12) — `overview.md`가 29개라 파일명만으로는
      // 어느 것인지 못 고른다. 맞추는 재료도 이 둘이라, 왜 떴는지가 줄 안에서 설명된다.
      return { name: hit.title, detail: hit.path };
    case "text":
      // 문서 줄이 드는 것에 **스니펫 하나가 더 선다** — 열기 전에 왜 떴는지를 말하는 자리다
      // (결정 6). 어느 work의 무엇인지는 문서 줄과 같은 이유로 함께 서야 한다(결정 12).
      return { name: hit.title, detail: hit.path, snippet: hit.snippet };
  }
}

/** 아카이브 화면에서 열리는가. 갈래 셋에만 있는 성질이라 **태그로 가른다.** */
const isArchived = (hit: SearchHit) =>
  (hit.kind === "work" || hit.kind === "doc" || hit.kind === "text") && hit.archived;

/** React가 줄을 붙잡는 표. 갈래가 다르면 slug가 같아도 다른 줄이다. */
function rowKey(hit: SearchHit): string {
  switch (hit.kind) {
    case "destination":
      return `destination/${hit.key}`;
    case "work":
      return `work/${hit.archived}/${hit.slug}`;
    case "project":
      return `project/${hit.slug}`;
    case "doc":
      return `doc/${hit.archived}/${hit.slug}/${hit.path}`;
    case "text":
      // 같은 문서가 이름으로도 본문으로도 맞으면 **두 층에 한 줄씩 선다** — 층이 답하는
      // 물음이 다르기 때문이다. 갈래가 키 앞에 붙어 있어 React가 그 둘을 안 섞는다.
      return `text/${hit.archived}/${hit.slug}/${hit.path}`;
  }
}

/**
 * 창 안에 그려지는 것 전부 — 입력칸과 목록. **상태와 콜백만 받는다** — 이 조각이 정적 마크업
 * seam에서 재는 것이다. 그래서 여기에는 포털을 넣지 않는다: 포털은 정적 렌더에서 아무것도 안
 * 그린다. 창(바깥)과 키 처리는 아래 `PalettePopup`이 든다.
 */
export function SearchList({
  mode,
  query,
  hits,
  state,
  selected,
  onQuery,
  onGo,
  inputRef,
}: {
  /**
   * 어느 세계의 목록인가. **그리는 데 이것이 필요한 자리는 목적지 라벨 하나다**(`rowText`) —
   * 코어가 목적지는 `key`만 돌려주고(결정 21) 그 key를 말로 푸는 표가 세계마다 다르다.
   * 여기서 안 받고 주소로 되짚으면 `/settings`가 늘 Atelier로 눕는다(`mode.ts`의 `modeOf`).
   */
  mode: Mode;
  query: string;
  hits: SearchHit[];
  /**
   * 물음이 어디까지 갔는가. **빈 목록으로는 셋을 못 가른다** — 아직 모른다 · 없다 · 못 물었다.
   *
   * `ready: boolean`이던 자리다. 그때 머리말은 「「없다」인지 「아직 모른다」인지」 둘만 셌고,
   * 셋째가 첫째로 접혀 있었다: 첫 질의가 실패하면 `data`가 영영 `undefined`라 「맞는 것이
   * 없습니다」조차 안 뜨고 **입력칸과 빈 상자만** 남았다 — 아래 「빈 목록은 아무 말도 안 하면
   * 고장과 구별되지 않는다」가 막으려던 그 화면을, 진짜 고장일 때만 만들었다.
   *
   * - `"pending"` — 아직 모른다. **아무 말도 안 한다.** 팔레트는 열 때마다 새로 마운트되고
   *   캐시도 안 남기므로(hooks.ts), 첫 답이 오기 전 한 프레임을 「맞는 것이 없습니다」로 채우면
   *   여는 것마다 그 줄이 깜빡인다.
   * - `"ready"` — 답이 왔다. 비어 있으면 없다고 말한다.
   * - `"failed"` — 못 물었다. 재시도는 없으므로(hooks.ts) **다음 타자가 곧 다음 시도**다.
   */
  state: "pending" | "ready" | "failed";
  /** 지금 골라진 줄. 목록이 비면 아무 줄도 안 골라진다(`-1`). */
  selected: number;
  onQuery: (query: string) => void;
  onGo: (hit: SearchHit) => void;
  /** 입력칸을 붙잡는 자리 — 창의 첫 포커스와 첫 프레임 가드가 이 칸을 가리킨다. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // 줄마다 id를 준다 — 입력칸이 켜진 줄을 **id로 가리킨다**(`aria-activedescendant`). 자리로 짓는
  // 것은 켜짐이 자리로 옮기기 때문이다: 목록이 갈리면 id도 같은 렌더에서 함께 갈린다.
  const listId = useId();
  const rowId = (at: number) => `${listId}-${at}`;

  // 방향키로 목록 밖까지 내려가면 골라진 줄이 화면에서 사라진다 — 훑는 것이 고르는 것보다
  // 비싸지 않아야 한다는 것이 프리뷰를 없앤 이유였다(결정 6). 골라진 줄은 **표시**로 찾는다:
  // 자리로 세면 목록이 갈릴 때마다 두 자리가 어긋난다.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      {/* **디바운스가 없다**(결정 29). 글자 하나마다 그대로 물어본다 — 그만큼 싼 일에
          지연을 얹으면 「치는 동안 즉시 따라온다」를 스스로 깨는 것이다. 얼마나 싼지는
          코어 주석 한 자리에 있다(`search.rs`의 `search`). */}
      <Input
        ref={inputRef}
        // 팔레트에 제목이 없다(결정 17) — 이 칸이 첫 줄이라 아래 목록과 선 하나로 갈린다.
        variant="flush"
        type="text"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        aria-label="검색어"
        // 판 02가 뒤지는 것을 늘렸으므로 안내말도 함께 는다 — 「이름으로」만 적혀 있으면
        // 본문으로도 찾는다는 것을 아무 데서도 말하지 않는다.
        placeholder="이름과 본문으로 좁히기"
        // **포커스는 이 칸에 머물고 켜짐만 옮긴다**(스토리 84) — 읽기 도구는 칸을 떠나지 않고 켜진
        // 줄을 읽는다. 목록이 비면 가리킬 줄이 없다.
        aria-controls={listId}
        aria-activedescendant={selected >= 0 ? rowId(selected) : undefined}
      />
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="검색 결과"
        // 구르는 상자는 저장소 공통 막대를 쓴다(결정 32) — 한 자리만 다른 막대를 쓰면
        // 그 자리에서 폭이 달라지고, 화면에는 「목록이 밀렸다」로 보인다. 다만 팔레트가
        // 떠 있는 동안은 그 막대가 걷힌다(아래 `SearchPalette`의 `data-paletteOpen` 주석) — 그래서 **바닥이
        // 「더 있다」를 말하는 유일한 자리**이고, 그 일을 `data-more-fade`가 든다.
        data-more-fade=""
        className="flex min-h-0 flex-col gap-px overflow-y-auto p-1.5 scroll-quiet"
      >
        {hits.map((hit, at) => {
          const { name, detail, snippet } = rowText(mode, hit);
          // **목적지 줄만 글리프를 든다**(결정 17). 나머지 갈래는 `null`이라 빈 슬롯이 서고,
          // 그래서 글자 시작점이 층을 가로질러 하나다.
          const Glyph = hit.kind === "destination" ? destinationIcon(mode, hit.key) : null;
          return (
            <Fragment key={rowKey(hit)}>
              {/* **결과가 없는 그룹은 머리도 안 선다** — 갈래가 바뀌는 자리에서만 한 줄
                  낸다. 머리는 `role="option"`이 아니라 방향키가 여기 서지 않는다: 서면
                  Enter가 갈 곳이 없는 자리가 생긴다. */}
              {(at === 0 || hits[at - 1].kind !== hit.kind) && (
                <p
                  data-head=""
                  className="shrink-0 px-2.5 pb-0.5 pt-2 text-[11px] text-muted-foreground first:pt-0.5"
                >
                  {groupNameOf(mode, hit.kind)}
                </p>
              )}
              <div
                role="option"
                id={rowId(at)}
                // **Tab이 줄로 가지 않는다**(S13). 포커스는 입력칸에 있고 켜짐은 `aria-selected`가
                // 말한다 — 줄이 Tab을 받으면 「포커스한 줄」과 「Enter가 가는 켜진 줄」이 갈린다.
                tabIndex={-1}
                // 줄을 집는 표식. 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가 샌다.
                data-row=""
                aria-selected={at === selected}
                onClick={() => onGo(hit)}
                className={cn(
                  // 간격이 **9px**인 것은 사이드바 규격이다(결정 17·18) — 슬롯 17px과
                  // 합쳐 거터가 26px이 되고, 그 값이 사이드바 nav 줄의 글자 시작점과 같다.
                  "flex shrink-0 items-baseline gap-[9px] rounded-[8px] px-2.5 py-1.5 outline-none",
                  at === selected ? "bg-state-2" : "hover:bg-state-1",
                )}
              >
                {/* **거터는 모든 줄이 예약한다**(결정 18). 목적지가 아닌 줄은 빈 슬롯을
                    두는데, 안 두면 가는 곳 층만 한 단 들어간 것처럼 읽힌다 — 층이 갈려도
                    눈이 따라가는 세로선은 하나여야 한다.

                    **줄 padding이 아니라 flex 자식으로 문다.** padding으로 밀면 목적지
                    줄에서 padding과 글리프가 이중으로 밀고, 아래 스니펫 바닥이 컨테이너
                    **내용폭**의 1/3이라 padding이 그 바닥까지 175.3px → 166.7px로 깎는다.
                    자식은 내용폭을 안 바꾼다.

                    **`self-center`가 필요하다** — 줄이 `items-baseline`이라 없으면 글리프가
                    글자 베이스라인에 앉아 사이드바(`items-center`)와 세로 위치가 갈린다. */}
                <span data-gutter="" className="size-[17px] shrink-0 self-center">
                  {Glyph !== null && <Glyph className="size-[17px]" strokeWidth={1.7} />}
                </span>
                {/* **셋이 다 줄어든다.** 이름과 경로가 둘 다 안 줄면 줄에 남는 폭을
                    스니펫 혼자 무는데, 실측(2026-08-30, 줄 폭 526px)에서 제목이 39자인
                    work의 본문 줄이 스니펫에 남긴 폭이 106px, 한글 8자였다 — 제목이 더
                    길면 0이 되고 줄이 가로로 넘친다.

                    **그 숫자는 스니펫에 바닥이 생기기 전의 것이다.** 지금 스니펫은
                    `basis-1/3` 아래로 안 내려가므로(같은 폭에서 175.3px), 거터 26px이
                    나가는 곳은 스니펫이 아니라 **이름과 경로**다. */}
                <span className="truncate text-[13px] tracking-[-0.01em]">{name}</span>
                {detail !== undefined && (
                  <span className="truncate text-[12px] text-tertiary">{detail}</span>
                )}
                {/* **본문 줄만의 것이다.** 열기 전에 왜 떴는지를 말한다(결정 6). 코어는
                    맞은 문단을 통째로 펴서 보내고, 「한 줄에 얼마나 보일까」는 화면 폭이
                    정하는 것이라 그 판정이 여기 있다 — 그래서 **줄의 3분의 1은 떼어 둔다**
                    (같은 실측에서 175px·한글 13자). 남는 폭이 그보다 넓으면 그만큼 다
                    갖고(`grow`), 모자라면 이름과 경로가 대신 줄어든다. */}
                {snippet !== undefined && (
                  <span className="shrink-0 grow basis-1/3 truncate text-[12px] text-tertiary">
                    {snippet}
                  </span>
                )}
                {/* 아카이브는 **가는 화면이 다르다** — 고르기 전에 그것을 알아야 한다. */}
                {isArchived(hit) && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    아카이브
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
        {/* 빈 목록은 **아무 말도 안 하면 고장과 구별되지 않는다.** 줄이 아니므로 방향키가
            여기 서지 않는다(`role="option"`이 없다). */}
        {state === "ready" && hits.length === 0 && (
          <p data-note="" className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
            맞는 것이 없습니다
          </p>
        )}
        {/* **못 물은 것은 없는 것이 아니다.** 위 줄과 같은 규격으로 같은 자리에 선다 —
            갈리는 것은 문장뿐이다. 말의 꼴은 이 저장소가 실패를 말하는 꼴 그대로다
            (`showProblem`의 「…하지 못했습니다」). **이유는 안 적는다** — 여기로 오는 것은
            IO 오류뿐이라 사용자 손에 고칠 것이 없고, 다시 치는 것이 곧 다시 묻는 것이다. */}
        {state === "failed" && (
          <p data-note="" className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
            검색하지 못했습니다
          </p>
        )}
      </div>
    </>
  );
}

/**
 * 셸에 포커스가 있는 채로 팔레트가 뜨면, 창이 첫 포커스를 옮기는 다음 프레임까지 친 키가 셸로 간다.
 * 그 사이를 이것이 막는다(`first-frame-guard.ts`, S24). 팔레트는 앱에 하나라 가드도 하나다.
 *
 * **글자 키는 삼키지 않는다**(P11) — 입력칸이 달려 있어 가드가 포커스를 그 칸으로 먼저 옮기고, 그
 * 글자는 칸에 선다. 「첫 키부터 팔레트가 받는다」(스토리 86)가 그 한 프레임에도 선다.
 */
const guard = createFirstFrameGuard();

/**
 * 팔레트를 **여는 자리가 여는 그 순간** 부른다(앱 셸의 ⌘K · 검색 버튼). 떠 있는가를 드는 state는
 * 앱 셸에 있고, 그 state가 그려지기를 기다리면 그 사이가 다시 샌다 — 그래서 켜는 것만 여기서
 * 내보낸다. 끄는 것은 팔레트가 닫히면서 스스로 한다.
 */
export function armSearchPalette(): void {
  guard.arm();
}

/**
 * 친 것을 들고 목록을 물어 오고 키를 듣는 자리 — 곧 **창 자신**이다. 그리는 일은 위가 한다.
 *
 * **이 조각은 창이 떠 있는 동안에만 마운트된다**(`DialogPortal`의 자식이다) — 여는 것이 곧 다시
 * 묻는 것이라는 hooks.ts의 전제가 여기서 선다. 창(Popup)까지 이 조각이 그리는 것은 **키 처리가
 * 창에 있어야 해서다**(S25): 입력칸에만 달면 카드의 누를 것 없는 자리(그룹 머리 · 안내 · 여백)를
 * 누른 순간 포커스가 창으로 가고 그 뒤로 방향키가 죽는다. 입력칸의 키도 버블로 창에 온다.
 */
function PalettePopup({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // **셋을 여기서 가른다.** `data`만 꺼내면 「못 물었다」가 「아직 모른다」로 접힌다 —
  // `keepPreviousData`는 앞 성공이 있을 때만 값을 주므로, 열자마자 나간 첫 질의가 실패하면
  // `data`는 영영 `undefined`다.
  const { data, isError } = useSearchHits(mode, query);
  const state = isError ? "failed" : data === undefined ? "pending" : "ready";
  const hits = data?.hits ?? [];
  const [selected, setSelected] = useState(0);
  // 목록이 뒤늦게 오거나 짧아져도 고른 자리가 목록 밖으로 나가지 않는다.
  const at = hits.length === 0 ? -1 : Math.min(selected, hits.length - 1);

  // 입력칸은 두 자리가 붙잡는다 — 창의 첫 포커스와, 첫 프레임에 글자를 넘겨받을 칸(가드).
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback((element: HTMLInputElement | null) => {
    inputRef.current = element;
    guard.typeIntoRef(element);
  }, []);

  // **고르는 자리가 하나다.** 방향키와 마우스가 같은 것을 부른다 — 갈리면 한쪽만 퇴화해도
  // 화면에 티가 안 난다. 갈 곳이 없으면(모르는 목적지 `key`) 닫지도 않는다: 계약이 깨진
  // 것이므로 조용히 사라지는 것보다 그 자리에 서 있는 편이 낫다.
  //
  // 옮기는 것은 **셸의 문과 같은 함수**다(`navigateGuardingSettings`) — 설정 안에서 `Settings`
  // 줄을 골라도 보던 항목에 머물고 칸이 안 는다(UI개선 S18). 팔레트가 곧장 옮기면 이 문만 샌다.
  //
  // 골라서 떠났는가를 적어 둔다 — 창이 포커스를 돌려줄지를 그것으로 가른다(아래 `finalFocus`). 이
  // 조각은 열 때마다 새로 붙으므로 도로 내릴 자리가 없다.
  const went = useRef(false);
  const go = (hit: SearchHit) => {
    const target = hitTarget(mode, hit);
    if (target === null) return;
    went.current = true;
    onClose();
    void navigateGuardingSettings(router, target);
  };

  // ↓/↑는 끝에서 멈춘다(돌지 않는다). Enter는 켜진 줄로 간다. **Esc는 여기 없다** — 창이 받아
  // 닫고(`onOpenChange`) 거기서 멈춘다. 그래서 팔레트 위에 확인 창이 떠 있을 때의 Esc는 포커스가 든
  // 확인 창만 닫는다.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(at + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(at - 1, 0));
    } else if (event.key === "Enter" && at >= 0) {
      event.preventDefault();
      go(hits[at]);
    }
  };

  return (
    <DialogPopup
      ref={guard.surfaceRef}
      variant="palette"
      // 팔레트에는 보이는 제목이 없다(결정 17) — 창의 이름은 여는 버튼과 같은 말이다.
      aria-label="검색"
      // 닫기 버튼이 없다 — Esc와 바깥 누르기로 닫는다(지금 규칙).
      showCloseButton={false}
      initialFocus={inputRef}
      // **골라서 떠났으면 포커스를 열기 전 자리로 돌려주지 않는다.** 창은 닫히는 애니메이션 뒤에
      // 돌려주는데, 그때는 고른 곳으로 이미 옮긴 뒤다 — 분할에서 문서를 고르면 셸 열로 돌아간 포커스가
      // 「이 열을 봤다」로 읽혀 본문을 셸로 되돌린다(결정 97). Esc·바깥 누르기로 닫으면 돌려준다.
      finalFocus={() => !went.current}
      onKeyDown={onKeyDown}
    >
      <SearchList
        mode={mode}
        query={query}
        hits={hits}
        state={state}
        selected={at}
        onQuery={(next) => {
          setQuery(next);
          // 좁히면 **맨 위로 돌아간다.** 자리를 그대로 두면 방금 친 글자가 만든 목록에서
          // 엉뚱한 줄이 골라진 채로 Enter를 기다린다.
          setSelected(0);
        }}
        onGo={go}
        inputRef={setInput}
      />
    </DialogPopup>
  );
}

/**
 * 떠 있는가를 받아 창을 여닫는 자리. 떠 있는가는 앱 셸이 든다 — 여는 길이 셋(⌘K · 검색 버튼 ·
 * 메뉴)이라 그 state가 한 자리에 살아야 한쪽으로 연 팔레트를 다른 쪽이 안다.
 *
 * **어느 세계인지를 받아서 안다**(결정 1). 스스로 주소를 보고 `modeOf`로 되짚지 않는 이유는
 * `/settings`가 세계 밖이기 때문이다 — 접두사가 없어 그 주소는 늘 Atelier로 눕고, 그러면
 * Maison에서 설정을 열어 둔 채 누른 ⌘K만 저쪽 세계를 뒤진다. 셸이 이미 그 합성을 들고 있어
 * (`AppShell.tsx`의 `shellMode`) 여기서 다시 구독할 이유도 없다.
 *
 * **닫히면 포커스는 열기 전 자리로 돌아간다** — 셸에서 열었으면 셸이다. 창이 돌려준다(Base UI).
 * 안 돌려주면 Esc 뒤에 친 글자가 아무 데도 안 들어간다.
 */
function SearchPalette({
  mode,
  open,
  onClose,
}: {
  mode: Mode;
  open: boolean;
  onClose: () => void;
}) {
  // **떠 있는 동안 스크롤 막대를 걷는다.** 막대는 `z-index: 45`이고 이 가림막이 `z-50`이라
  // 막대가 **아래**에 깔리는데, 가림막이 반투명이라 그대로 비쳐 보인다 — 팔레트를 열기
  // 직전까지 굴리던 화면의 막대가 가림막 너머로 남아 페이드되는 것이 그 모양이다
  // (`HIDE_DELAY_MS` 420ms + 페이드 180ms).
  //
  // 막대를 위로 올려 해결하지 않는다: 뒤 화면은 **팔레트가 떠 있는 동안 구를 수 없고**
  // (가림막이 포인터를 다 받는다) 구를 수 없는 것의 막대는 거짓이다. 팔레트 제 목록의
  // 막대도 함께 걷힌다 — 어차피 카드(`bg-background`, z-50)가 그 자리를 덮어 보인 적이 없다.
  //
  // 자리가 `body`인 것은 막대가 `body` 직계 fixed라서다(`lib/scroll-quiet.ts`) — 이 컴포넌트의
  // 서브트리 안에서는 그 노드에 닿는 선택자를 쓸 수 없다.
  //
  // 닫히면 첫 프레임 가드도 끈다 — 포커스가 한 번도 안 들어온 채 닫혀도 가드가 남지 않는다.
  useEffect(() => {
    if (!open) return;
    document.body.dataset.paletteOpen = "";
    return () => {
      delete document.body.dataset.paletteOpen;
      guard.disarm();
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Portal은 창이 떠 있는 동안(닫히는 애니메이션까지)만 자식을 세운다. 가림막은 모든 모달의
          막(`modal-scrim`)이고, 그것을 누르면 닫힌다 — 여는 것 말고는 아무 일도 안 하는 표면이라
          닫는 데 잃는 것이 없다. 위에 뜬 확인 창의 버튼은 이 막이 아니라 닫지 않는다. */}
      <DialogPortal>
        <DialogOverlay />
        <PalettePopup mode={mode} onClose={onClose} />
      </DialogPortal>
    </Dialog>
  );
}

export default SearchPalette;

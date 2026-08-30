import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { destinationLabel } from "./destinations";
import { useSearchHits } from "./hooks";
import { hitTarget } from "./hit-target";
import type { SearchHit } from "./types";

/**
 * ⇧⇧로, 또는 셸 컨트롤 행의 검색 버튼으로 여는 검색 팔레트. **여는 자리는 그래도 하나다** —
 * 버튼은 키 리스너와 같은 state를 켤 뿐이다(`AppShell.tsx`의 `ShellControls` 호출부).
 *
 * **떠 있는 표면의 규격은 확인 창(`AppDialog`)의 것을 그대로 쓴다** — `rounded-[13px]` ·
 * `border-border-strong` · `bg-background` · `shadow-lg`. 이 저장소의 떠 있는 것들이 같은
 * 반지름·테두리·그림자를 쓰고 있어 새 어휘를 들일 이유가 없다.
 *
 * **여는 키(⇧⇧)의 판정은 여기 없다** — `shell-registry.ts`의 `searchHotkey`가 든다. 셸 키
 * 판정들과 「어디서 눌렸으면 비키는가」를 같이 딛기 때문이고, 그 자리를 고른 이유는 거기
 * 머리말이 든다. 무장·해제를 들고 그 함수를 부르는 자리는 앱 셸(`AppShell.tsx`)이다.
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
const GROUP: Record<SearchHit["kind"], string> = {
  destination: "가는 곳",
  work: "작업",
  project: "프로젝트",
  doc: "문서",
  text: "본문",
};

/**
 * 줄에 서는 말. **갈래마다 다르다** — 코어가 태그를 달아 보내는 이유가 이것이다.
 * 목적지의 라벨은 프런트 것이라(결정 21) 코어가 준 `key`로 여기서 되찾는다.
 */
function rowText(hit: SearchHit): { name: string; detail?: string; snippet?: string } {
  switch (hit.kind) {
    case "destination":
      return { name: destinationLabel(hit.key) };
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
 * 그려지는 것 전부. **상태와 콜백만 받는다** — 이 조각이 정적 마크업 seam에서 재는 것이다.
 */
export function SearchList({
  query,
  hits,
  state,
  selected,
  onQuery,
  onGo,
  onClose,
}: {
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
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // **포커스를 빌렸다가 돌려준다.** 입력칸이 생기면서 팔레트를 열 때마다 포커스가 셸을 떠나는데,
  // 안 돌려주면 Esc 뒤에 친 글자가 아무 데도 안 들어간다. `autoFocus` 대신 여기서 옮기는 것은
  // **순서 때문이다** — 그 속성은 커밋 중에 먹어서, 이 효과가 도는 시점에는 「어디 있었나」가
  // 이미 입력칸으로 덮여 있다.
  useEffect(() => {
    const before = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  // 방향키로 목록 밖까지 내려가면 골라진 줄이 화면에서 사라진다 — 훑는 것이 고르는 것보다
  // 비싸지 않아야 한다는 것이 프리뷰를 없앤 이유였다(결정 6). 골라진 줄은 **표시**로 찾는다:
  // 자리로 세면 목록이 갈릴 때마다 두 자리가 어긋난다.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // **떠 있는 동안 스크롤 막대를 걷는다.** 막대는 `z-index: 45`이고 이 오버레이가 `z-50`이라
  // 막대가 **아래**에 깔리는데, 오버레이가 반투명이라 그대로 비쳐 보인다 — 팔레트를 열기
  // 직전까지 굴리던 화면의 막대가 오버레이 너머로 남아 페이드되는 것이 그 모양이다
  // (`HIDE_DELAY_MS` 420ms + 페이드 180ms).
  //
  // 막대를 위로 올려 해결하지 않는다: 뒤 화면은 **팔레트가 떠 있는 동안 구를 수 없고**
  // (오버레이가 포인터를 다 받는다) 구를 수 없는 것의 막대는 거짓이다. 팔레트 제 목록의
  // 막대도 함께 걷힌다 — 어차피 카드(`bg-background`, z-50)가 그 자리를 덮어 보인 적이 없다.
  //
  // 자리가 `body`인 것은 막대가 `body` 직계 fixed라서다(`lib/scroll-quiet.ts`) — 이 컴포넌트의
  // 서브트리 안에서는 그 노드에 닿는 선택자를 쓸 수 없다.
  useEffect(() => {
    document.body.dataset.paletteOpen = "";
    return () => {
      delete document.body.dataset.paletteOpen;
    };
  }, []);

  return (
    <div
      // 바깥을 눌러도 닫힌다 — 확인 창과 같은 규칙이고, 여는 것 말고는 아무 일도 안 하는
      // 표면이라 닫는 데 잃는 것이 없다.
      onClick={onClose}
      // 막은 **확인 창과 같은 것을 쓴다**(`modal-scrim` — 뒤를 흐리지 않고 어둡게만 한다).
      // 뜨는 자리만 여기가 정한다: 팔레트는 위쪽 12vh에 서고 확인 창은 가운데다.
      className="modal-scrim flex items-start justify-center p-8 pt-[12vh]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-[560px] max-w-full flex-col overflow-hidden rounded-[13px] border border-border-strong bg-background shadow-lg"
      >
        {/* **디바운스가 없다**(결정 29). 글자 하나마다 그대로 물어본다 — 그만큼 싼 일에
            지연을 얹으면 「치는 동안 즉시 따라온다」를 스스로 깨는 것이다. 얼마나 싼지는
            코어 주석 한 자리에 있다(`search.rs`의 `search`). */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label="검색어"
          // 판 02가 뒤지는 것을 늘렸으므로 안내말도 함께 는다 — 「이름으로」만 적혀 있으면
          // 본문으로도 찾는다는 것을 아무 데서도 말하지 않는다.
          placeholder="이름과 본문으로 좁히기"
          // 팔레트에 제목이 없다(결정 17) — 이 칸이 첫 줄이라 아래 목록과 선 하나로 갈린다.
          className="shrink-0 border-b border-border px-3.5 py-2.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <div
          ref={listRef}
          role="listbox"
          aria-label="검색 결과"
          // 구르는 상자는 저장소 공통 막대를 쓴다(결정 32) — 한 자리만 다른 막대를 쓰면
          // 그 자리에서 폭이 달라지고, 화면에는 「목록이 밀렸다」로 보인다. 다만 팔레트가
          // 떠 있는 동안은 그 막대가 걷힌다(위 `data-paletteOpen` 주석) — 그래서 **바닥이
          // 「더 있다」를 말하는 유일한 자리**이고, 그 일을 `data-more-fade`가 든다.
          data-more-fade=""
          className="flex min-h-0 flex-col gap-px overflow-y-auto p-1.5 scroll-quiet"
        >
          {hits.map((hit, at) => {
            const { name, detail, snippet } = rowText(hit);
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
                    {GROUP[hit.kind]}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  // 줄을 집는 표식. 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가 샌다.
                  data-row=""
                  aria-selected={at === selected}
                  onClick={() => onGo(hit)}
                  className={cn(
                    "flex shrink-0 items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left",
                    at === selected ? "bg-state-2" : "hover:bg-state-1",
                  )}
                >
                  {/* **셋이 다 줄어든다.** 이름과 경로가 둘 다 안 줄면 줄에 남는 폭을
                      스니펫 혼자 무는데, 실측(2026-08-30, 줄 폭 526px)에서 제목이 39자인
                      work의 본문 줄이 스니펫에 남긴 폭이 106px, 한글 8자였다 — 제목이 더
                      길면 0이 되고 줄이 가로로 넘친다. */}
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
                </button>
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
      </div>
    </div>
  );
}

/** 친 것을 들고 목록을 물어 오고 키를 듣는 자리. 그리는 일은 위가 한다. */
function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  // **셋을 여기서 가른다.** `data`만 꺼내면 「못 물었다」가 「아직 모른다」로 접힌다 —
  // `keepPreviousData`는 앞 성공이 있을 때만 값을 주므로, 열자마자 나간 첫 질의가 실패하면
  // `data`는 영영 `undefined`다.
  const { data, isError } = useSearchHits(query);
  const state = isError ? "failed" : data === undefined ? "pending" : "ready";
  const hits = data?.hits ?? [];
  const [selected, setSelected] = useState(0);
  // 목록이 뒤늦게 오거나 짧아져도 고른 자리가 목록 밖으로 나가지 않는다.
  const at = hits.length === 0 ? -1 : Math.min(selected, hits.length - 1);

  // **고르는 자리가 하나다.** 방향키와 마우스가 같은 것을 부른다 — 갈리면 한쪽만 퇴화해도
  // 화면에 티가 안 난다. 갈 곳이 없으면(모르는 목적지 `key`) 닫지도 않는다: 계약이 깨진
  // 것이므로 조용히 사라지는 것보다 그 자리에 서 있는 편이 낫다.
  const go = (hit: SearchHit) => {
    const target = hitTarget(hit);
    if (target === null) return;
    onClose();
    void navigate(target);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        handled();
        onClose();
      } else if (event.key === "ArrowDown") {
        handled();
        setSelected(Math.min(at + 1, hits.length - 1));
      } else if (event.key === "ArrowUp") {
        handled();
        setSelected(Math.max(at - 1, 0));
      } else if (event.key === "Enter" && at >= 0) {
        handled();
        go(hits[at]);
      }
    };
    // **캡처로 듣는다.** 셸에 포커스가 있는 채로 열렸으면 xterm의 키 핸들러가 먼저 보는
    // 자리라, 버블에서 기다리면 방향키가 셸로 들어간 뒤다(`AppDialog`가 Esc를 같은 이유로
    // 캡처에서 듣는다). 글자 키는 안 잡는다 — 포커스가 입력칸에 있으므로 그리로 간다.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [at, hits, navigate, onClose]);

  return (
    <SearchList
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
      onClose={onClose}
      onGo={go}
    />
  );
}

export default SearchPalette;

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutDirRef } from "@/features/works/refs";
import { modeNameOf } from "@/mode";
import { specLayoutStatesQuery } from "./hooks";
import type { SpecLayoutState } from "./types";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 결정 20·23·25, 티켓 08). 모드마다 레이아웃이 하나라
// Atelier와 Maison이 한 행씩 선다. **이 화면의 주된 쓰임은 확인이다** — 레이아웃은 대부분 에이전트가
// 고치고, 사람은 여기서 참조를 복사해 앱 터미널의 에이전트에게 붙인다.
//
// **설정 파일 읽기 게이트 밖에 선다**(에이전트 훅 페이지와 같다) — 레이아웃은 `settings.json`에 살지
// 않고, 설정 초안의 저장 버튼도 지나지 않는다.
//
// 행은 페이지를 열 때, 레이아웃 폴더가 바뀔 때(셸의 `useFollowLayoutChanges`), [다시 읽기]를 누를 때
// 새로 읽는다(`specLayoutStatesQuery`에 `staleTime`이 없다). 행의 상태는 엔진이 판정해 준 그대로
// 그린다 — resolve 규칙을 여기서 다시 계산하지 않는다.

/** 복사 알림이 떠 있는 시간. 참조 한 줄과 할 일 한 문장을 읽을 만큼 — 닫기 버튼도 있다. */
const NOTICE_MS = 6000;

function SpecLayoutPage() {
  const states = useQuery(specLayoutStatesQuery());
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // **참조는 상태가 준 폴더 경로로 짓는다**(결정 23) — 폴더가 아직 없어도 같은 모양이다: 붙여 받은
  // 에이전트의 도구가 내장본을 돌려준다. 읽지 못하는 행에도 있다: 에이전트가 원문과 오류를 읽고 고친다.
  const ask = (state: SpecLayoutState) => {
    const reference = layoutDirRef(state.folder);
    navigator.clipboard.writeText(reference);
    setCopied(reference);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), NOTICE_MS);
  };
  const closeNotice = () => {
    window.clearTimeout(timer.current);
    setCopied(null);
  };
  const reread = () => void states.refetch();

  return (
    <>
      {states.data !== undefined && (
        <SpecLayoutSection states={states.data} onAsk={ask} onReread={reread} />
      )}
      {/* 읽기 자체가 실패한 길(IPC). 한 모드의 폴더가 깨진 것은 여기가 아니라 그 행에 선다. */}
      {states.error !== null && (
        <div className="flex flex-col items-start gap-3 pt-2">
          <p className="text-[13.5px] leading-[1.7] text-red-600">{String(states.error)}</p>
          {states.data === undefined && (
            <button
              type="button"
              onClick={reread}
              className="h-7 rounded-[9px] px-[11px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover"
            >
              다시 읽기
            </button>
          )}
        </div>
      )}
      {copied !== null && <CopiedNotice reference={copied} onClose={closeNotice} />}
    </>
  );
}

/**
 * 모드 두 행 — 테두리 있는 목록 하나(프로토타입의 모양 그대로). 값을 들지 않는다: 페이지가 들고
 * 이쪽은 그리기만 한다(마크업 테스트가 클릭을 못 건다 — `HooksSection`과 같은 이유).
 *
 * [편집]은 편집기가(티켓 11), ⋯ 메뉴의 되돌리기는 티켓 10이 이 행에 더한다.
 */
export function SpecLayoutSection({
  states,
  onAsk,
  onReread,
}: {
  states: SpecLayoutState[];
  onAsk: (state: SpecLayoutState) => void;
  /** 모드 둘의 상태를 다시 읽는다. 감시(티켓 09)가 놓친 경우를 위한 길이다. */
  onReread: () => void;
}) {
  return (
    <section className="flex flex-col gap-5 pt-2">
      <p className="text-[13px] leading-[1.7] text-tertiary">
        모드마다 레이아웃이 하나예요. <code>spec</code> 패널 탭과 에이전트가 받는 안내문이 같은
        레이아웃에서 나와요. <strong className="font-medium">부탁</strong>을 누르면 참조가 복사돼요 —
        앱 터미널의 에이전트에게 붙이고 원하는 모양을 이어 적으세요.
      </p>
      <ul className="flex flex-col rounded-[12px] border border-border">
        {states.map((state, index) => (
          <ModeRow
            key={state.id}
            state={state}
            first={index === 0}
            onAsk={() => onAsk(state)}
            onReread={onReread}
          />
        ))}
      </ul>
    </section>
  );
}

// 행 버튼의 규격은 이 화면의 「다시 읽기」와 같은 가족이다 — 저장 같은 주 버튼이 아니다.
const ROW_BUTTON =
  "inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[9px] px-[9px] text-[13.5px] font-medium text-muted-foreground transition-colors quiet-hover";

/**
 * 모드 한 행. 상태는 셋 중 하나다 — 내장본 그대로, 고침(가린 폴더 경로와 템플릿 개수), 읽지 못해
 * 내장본으로 물러섬(앰버 한 줄, 경로와 이유 한 줄, [다시 읽기]). 읽지 못한 행도 가린 폴더가 있으므로
 * 고친 행이다(구현 스펙 5절).
 */
function ModeRow({
  state,
  first,
  onAsk,
  onReread,
}: {
  state: SpecLayoutState;
  first: boolean;
  onAsk: () => void;
  onReread: () => void;
}) {
  // 행의 머리. 모드 이름이 곧 레이아웃의 이름이다(결정 25) — 세그먼트와 같은 표에서 읽는다.
  const name = modeNameOf(state.id);
  const reference = layoutDirRef(state.folder);
  const fellBack = state.fallback !== null;
  return (
    <li className={cn("flex items-start gap-3 py-3 pr-2.5 pl-3.5", !first && "border-t border-border")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-[22px] items-center gap-2">
          <span className="text-[13.5px] font-medium">{name}</span>
          {state.edited && (
            <span className="inline-flex h-[18px] items-center rounded-[6px] bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
              고침
            </span>
          )}
        </div>
        {fellBack ? (
          <div className="flex items-start gap-2">
            <TriangleAlert
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
              strokeWidth={2}
            />
            <div className="flex min-w-0 flex-col gap-0.5 text-[12.5px] leading-[1.6]">
              <span className="text-amber-700 dark:text-amber-400">
                읽지 못해 내장본으로 보여 주고 있어요
              </span>
              {/* 까닭은 엔진의 글 그대로다 — 에이전트가 물러선 안내문에서 받는 것과 같다. */}
              <span className="break-words text-tertiary">
                {reference} · {state.fallback}
              </span>
            </div>
          </div>
        ) : (
          <span className="break-words text-[12.5px] leading-[1.6] text-tertiary">
            {state.edited
              ? `${reference} 폴더가 내장본을 가리고 있어요 · 템플릿 ${state.templateCount ?? 0}개`
              : "내장본 그대로예요"}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onAsk}
          aria-label={`${name} 레이아웃을 에이전트에게 부탁`}
          title={`${reference} 참조를 복사해요`}
          className={ROW_BUTTON}
        >
          <Bot aria-hidden className="size-3.5" strokeWidth={1.9} />
          부탁
        </button>
        {fellBack && (
          <button
            type="button"
            onClick={onReread}
            aria-label={`${name} 레이아웃 다시 읽기`}
            className={cn(ROW_BUTTON, "px-[11px]")}
          >
            다시 읽기
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * [부탁]을 누른 뒤 화면 아래에 서는 어두운 알림 하나(프로토타입). 복사한 참조와 다음에 할 일을 적는다
 * — 클립보드에 든 것은 참조 한 줄뿐이고, 부탁은 사람이 앱 터미널에서 이어 적는다(결정 23).
 *
 * 설정 본문(`SettingsPage`의 `main`) 기준으로 설정 한 열의 왼쪽 끝에 맞춰 선다.
 */
export function CopiedNotice({ reference, onClose }: { reference: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="absolute bottom-7 left-8 z-20 flex w-[min(620px,calc(100%-4rem))] items-start gap-2.5 rounded-[12px] bg-foreground py-3 pr-3 pl-3.5 text-background shadow-lg"
    >
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-green-400" strokeWidth={2.2} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[13.5px] font-medium break-words">
          참조를 복사했어요 <code className="text-[12px] opacity-80">{reference}</code>
        </span>
        <span className="text-[12.5px] leading-[1.6] opacity-75">
          앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="알림 닫기"
        className="flex size-6 shrink-0 items-center justify-center rounded-[7px] opacity-75 transition-opacity hover:opacity-100"
      >
        <X aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export default SpecLayoutPage;

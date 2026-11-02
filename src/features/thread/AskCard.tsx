import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// 사람의 답을 기다리는 카드의 한 겉(restart 02b-5 · 시안 Cards 보드 `.ra-ask` — 「승인 카드」 여섯 칸 · 「Runtime 없음」 · Thread 보드 로그인 카드) — 승인 ·
// 계획 · 질문 · 로그인 · Runtime 없음 카드가 입력창 자리를 빌려 이 겉으로 선다. 입력창 자리의 다른 카드(작업공간 제안 · Project · 도구 질문)는 시안에
// 없어 제 겉(`SLOT_CARD`)에 둥글기만 맞췄다(스펙 「02b — 대화창」).
//
// - **겉** — 둥근 22(`prompt` — 입력창과 같다) · 입력창 면(`surface-composer`)과 그림자(`shadow-composer`). 폭은 입력창 자리 그대로다.
// - **위 칸**(`.top`) — 안쪽 14 16 10 · 사이 8. 갈래 줄(글리프 14 · 사이 6 · 12 / 18 `fg-tool`), 물음(14 / 20 · 500), 명령 상자(`.cmd` — 안쪽 8 · 둥근
//   8 · `fill-soft` · 고정폭 12 / 18 · 500 `fg-secondary`)나 줄어든 diff, 아래 한 줄(`.why` — 12 / 18 `fg-tool`).
// - **단추 줄**(`.acts`) — 사이 8 · 안쪽 2 10 10 12, 넘치면 다음 줄로 간다. 왼쪽 옅은 알약(`.ra-opt` 28 · 좌우 12 · 안 1 `border-heavy`), 빈칸, 오른쪽
//   테두리 알약(`.ra-no` 32 · 좌우 14)과 검은 알약(`.ra-yes` 32 · 좌우 14 / 12 · 500)이다. 글쇠는 단추 글 뒤 12 · 옅음 .6이다. 긴 글의 알약(`.ra-opt.long`)은
//   단추 안에서 접히고(둥근 8 · 위아래 5) 그 줄은 다음 줄로 가지 않는다 — 거부와 허용이 오른쪽 한 줄에 남는다.

/** 겉 — 둥근 22 · 입력창 면 · 입력창 그림자(보드 `.ra-ask`). */
export const ASK_CARD = "flex shrink-0 flex-col overflow-hidden rounded-prompt bg-surface-composer shadow-composer outline-none";

/** 아래 한 줄(보드 `.why`) — 사유 · 대상 · 할 일. */
export const ASK_WHY = "text-xs text-fg-tool wrap-anywhere";

/** 명령 · 도구 입력 상자(보드 `.cmd`) — 안쪽 8 · 둥근 8 · `fill-soft` · 고정폭 12 / 18 · 500 `fg-secondary`. */
export const ASK_CODE =
  "rounded-md bg-fill-soft p-2 font-mono text-xs font-medium tracking-normal whitespace-pre-wrap wrap-anywhere text-fg-secondary";

/** 위 칸(보드 `.top`) — 안쪽 14 16 10 · 사이 8. */
export function AskTop({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 px-4 pt-3.5 pb-2.5">{children}</div>;
}

/** 갈래 줄(보드 `.kind`) — 글리프 14 · 사이 6 · 12 / 18 `fg-tool`. 오른쪽 끝에 물음 차례(`AskCount`)가 설 수 있다. */
export function AskKind({ icon: Icon, label, aside }: { icon: LucideIcon; label: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-tool">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      {aside}
    </div>
  );
}

/** 물음(보드 `.ttl`) — 14 / 20 · 500. */
export function AskTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="break-keep text-sm font-medium text-fg">
      {children}
    </p>
  );
}

/** 단추 줄(보드 `.acts`) — 긴 글의 알약이 있으면 다음 줄로 가지 않는다(`.acts:has(.ra-opt.long)`). */
export function AskActs({ long = false, children }: { long?: boolean; children: ReactNode }) {
  return (
    <div data-acts={long ? "long" : ""} className={cn("flex items-center gap-2 pt-0.5 pr-2.5 pb-2.5 pl-3", long ? "flex-nowrap" : "flex-wrap")}>
      {children}
    </div>
  );
}

/** 왼쪽 단추들과 오른쪽 단추들 사이의 빈칸(보드 `.ra-grow`). */
export function AskGrow() {
  return <span aria-hidden className="min-w-0 flex-1" />;
}

/**
 * 단추 모양 — 왼쪽 옅은 알약 · 오른쪽 테두리 알약 · 맨 오른쪽 검은 알약, 그리고 보드에 없는 글 단추(`quiet` — 질문 카드의 「나중에」: 테두리 없이
 * `fg-secondary`, hover에 `fill-soft` 면).
 */
export type AskTone = "opt" | "no" | "yes" | "quiet";

const TONES: Record<AskTone, string> = {
  opt: "h-7 px-3 text-fg inset-ring inset-ring-border-heavy transition-colors duration-basic ease-default enabled:hover:bg-fill-soft",
  no: "h-8 gap-1.5 px-3.5 text-fg inset-ring inset-ring-border-heavy transition-colors duration-basic ease-default enabled:hover:bg-fill-soft",
  yes: "h-8 gap-2 pr-3 pl-3.5 bg-fg font-medium text-fg-inverse transition-opacity duration-basic ease-default enabled:hover:opacity-88",
  quiet: "h-8 px-3 text-fg-secondary transition-colors duration-basic ease-default enabled:hover:bg-fill-soft enabled:hover:text-fg",
};

/**
 * 카드의 단추(보드 `.ra-opt` · `.ra-no` · `.ra-yes`). `keycap`은 글 뒤에 옅게 적는 글쇠(「Esc」 · 「↵」 — 12 · .6)이고 그림이라 숨는다. `long`은 긴 글이 단추 안에서
 * 접히는 알약이다(`.ra-opt.long` — 높이는 글만큼 · 28부터 · 위아래 5 · 둥근 8 · 왼쪽 맞춤).
 */
export function AskButton({
  tone,
  long = false,
  keycap = null,
  className,
  children,
  ...rest
}: { tone: AskTone; long?: boolean; keycap?: string | null } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-long={long || undefined}
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full text-chat-meta whitespace-nowrap focus-ring disabled:opacity-50",
        TONES[tone],
        long && "h-auto min-h-7 max-w-full shrink rounded-card py-1.25 text-left whitespace-normal",
        className,
      )}
    >
      {children}
      {keycap && (
        <span aria-hidden className="text-xs font-normal tracking-normal opacity-60">
          {keycap}
        </span>
      )}
    </button>
  );
}

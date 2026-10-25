import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// **상세 화면의 머리 crumb · 뒤로 알약 · 묶음 · 설명 칸**(03 구현 스펙 §14 · §16 · 시안 F1-ProjectDetail · F1-SpaceDetail) — Project 상세와
// Space 상세는 같은 짜임이라(03 결정 10 「머리 줄은 Projects / web-app」) 함께 쓴다(03 코드 리뷰 D1). 두 화면이 옮겨 적던 동안 설명 칸의
// Esc가 이미 갈렸다 — Project 쪽만 그만두기였다.

/** 머리 줄 이름 앞 흐린 자리와 「/」(시안 `.tb-c .muted`) — `onOpen`이 있으면 누르는 글(목록으로), 없으면 누르지 않는 글이다. */
export function HeadCrumb({ label, onOpen }: { label: string; onOpen?: () => void }) {
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring"
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 truncate text-sm text-fg-titlebar">{label}</span>
      )}
      <CrumbSlash />
    </>
  );
}

/** crumb 뒤의 「/」 — 이름 앞 자리를 메뉴로 여는 곳(Work 화면의 Space)도 이것을 쓴다. */
export function CrumbSlash() {
  return (
    <span aria-hidden className="shrink-0 text-sm text-fg-titlebar">
      /
    </span>
  );
}

/**
 * 상세 판 하나 — 맨 위 「← 목록」 알약 줄(오른쪽 끝에 `end` — Space의 ⋯ · 시작 단추), 그 아래 본문, 판 밖 왼쪽 아래의 토스트 자리(시안
 * `.toast` — 왼 40 · 아래 24)와 창. 판 안은 위 22 · 옆 40이고 스스로 구른다.
 */
export function DetailPanel({
  back,
  end,
  children,
  after,
}: {
  back: { to: "/projects" | "/spaces"; label: string };
  end?: ReactNode;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-5.5 pb-20 scroll-quiet">
        <div className="mb-5.5 flex items-center gap-2">
          {/* WebKit의 Tab은 맨 링크에 서지 않는다 — 상세 화면의 링크는 모두 `tabIndex`를 명시한다(목록 줄의 이름과 같다). */}
          <Link
            to={back.to}
            tabIndex={0}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-separator-soft bg-surface pr-3.5 pl-2.5 text-sm text-fg transition-colors hover:bg-fill-soft focus-ring"
          >
            <ArrowLeft aria-hidden className="size-3.5 text-fg-icon" />
            {back.label}
          </Link>
          {end && <span className="ml-auto flex items-center gap-1.5">{end}</span>}
        </div>
        {children}
      </div>
      <Toaster className="bottom-6 left-10 translate-x-0" />
      {after}
    </div>
  );
}

/** 묶음 하나 — 머리(18/26 이름 · 앞 칸 · 옅은 곁말 · 뒤 칸 · 끝 칸)와 몸. 묶음 사이는 34다(시안 `.sec2` · `.h2r`). */
export function Section({
  label,
  aside,
  before,
  after,
  end,
  children,
}: {
  label: string;
  aside?: string;
  before?: ReactNode;
  after?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="mt-8.5">
      <div className="mb-3 flex min-h-7 items-center gap-2">
        <h2 className="text-heading-sm text-fg">{label}</h2>
        {before}
        {aside !== undefined && <span className="text-chat-meta text-fg-tertiary">{aside}</span>}
        {after}
        {end && <span className="ml-auto flex items-center gap-1.5">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * 「설명」 묶음 — 연필 → 칸(열자마자 쓴다) → 저장 · 취소, 저장하면 「저장했어요」(Project 스토리 118 · Space 스토리 150). **Esc는 그만두기다** —
 * 친 글을 버리고 아무것도 고치지 않는다. `locked`면 연필이 꺼진다(고칠 자리를 모르는 Space 파일). `onSave`가 `false`면 칸이 그대로 남는다.
 */
export function DescriptionSection({
  text,
  aside,
  placeholder,
  locked = false,
  onSave,
}: {
  text: string;
  aside: string;
  placeholder: string;
  locked?: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (draft === null) return;
    if (await onSave(draft)) {
      setDraft(null);
      setSaved(true);
    }
  };
  return (
    <Section
      label="설명"
      before={
        draft === null && (
          <button
            type="button"
            aria-label="설명 고치기"
            disabled={locked}
            onClick={() => {
              setDraft(text);
              setSaved(false);
            }}
            className="rounded-sm p-0.5 text-fg-faint transition-colors hover:text-fg-secondary focus-ring disabled:opacity-40"
          >
            <Pencil aria-hidden className="size-3.5" />
          </button>
        )
      }
      aside={aside}
    >
      {draft === null ? (
        <>
          <p className={cn("text-chat-body whitespace-pre-wrap", text ? "text-fg" : "text-fg-tertiary")}>
            {text || "아직 설명이 없어요. 연필을 눌러 적어 두세요."}
          </p>
          {saved && (
            <p role="status" className="mt-2.5 flex items-center gap-1 text-xs text-fg-tertiary">
              <Check aria-hidden className="size-3" />
              저장했어요
            </p>
          )}
        </>
      ) : (
        <>
          <textarea
            // 열자마자 쓴다 — 연필을 누른 손이 곧바로 적는다.
            autoFocus
            rows={4}
            aria-label="설명"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
            }}
            placeholder={placeholder}
            className="block w-full resize-none rounded-xl border border-border-heavy bg-surface px-3 py-2.5 text-chat-body text-fg outline-none placeholder:text-fg-placeholder focus-ring"
          />
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="top" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button size="top" onClick={() => void save()}>
              저장
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

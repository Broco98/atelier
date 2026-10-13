import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// 대화창 카드의 틀 — 승인 카드(three-axes 티켓 21)와 안내 카드(티켓 22)가 함께 쓰는 캔버스의 한 틀이다(r28 · 입력창 그림자 · 위에
// 엔진 줄 · 제목 · 대상 · 까닭, 아래 단추 줄). 카드마다 다른 것은 위 칸의 글과 아래 줄(`children`)뿐이다.

/** 카드의 주 동작 — 검정 면(캔버스 `.cx-split` · `.cx-btn.primary`). 앱의 주 버튼은 파랑이라 카드에서 덮는다. */
export const CARD_PRIMARY = "bg-foreground text-background hover:bg-foreground/90";

interface ChatCardProps {
  /** 카드의 역할 — 승인 카드는 입력창 자리의 묶음(`group`), 안내 카드는 대화창 자리의 구획(`section`)이다. */
  as: "group" | "section";
  titleId: string;
  /** 엔진 줄 — 아이콘 하나와 글. */
  icon: LucideIcon;
  head: string;
  title: string;
  /** 명령 · 경로 · 설치 명령 같은 대상 — 고정폭 상자에 선다. 없으면 서지 않는다. */
  subject?: string | null;
  /** 까닭 줄 — 없으면 서지 않는다. */
  reason?: string | null;
  /** 거절된 명령의 글 — 카드 안에 알림으로 선다(호스트의 거절은 화면에 보일 글이다). */
  problem: string | null;
  /** 위 칸 아래 여백이 한 단 넓은가 — 계획 승인 카드(보드 그대로). */
  roomy?: boolean;
  className?: string;
  /** 아래 줄들 — 칩 줄 · 단추 줄. */
  children: ReactNode;
}

function ChatCard({ as, titleId, icon: Icon, head, title, subject, reason, problem, roomy, className, children }: ChatCardProps) {
  const body = (
    <>
      <div className={cn("flex flex-col gap-2 px-4 pt-4", roomy ? "pb-3.5" : "pb-3")}>
        <span className="flex items-center gap-1.5 text-caption text-(--chat-fg-tool)">
          <Icon className="size-3.5" strokeWidth={1.8} aria-hidden />
          {head}
        </span>
        <p id={titleId} className="break-keep text-row font-medium text-foreground">
          {title}
        </p>
        {subject && (
          <pre className="whitespace-pre-wrap break-all rounded-inner bg-state-2 p-2 font-mono text-mono-sm font-medium leading-[18px] text-muted-foreground">
            {subject}
          </pre>
        )}
        {reason && <p className="break-keep text-caption leading-[17px] text-(--chat-fg-tool)">{reason}</p>}
        {problem && (
          <p role="alert" className="text-caption text-destructive">
            {problem}
          </p>
        )}
      </div>
      {children}
    </>
  );
  const frame = cn("flex flex-col rounded-(--chat-radius-composer) bg-card shadow-(--chat-shadow-composer)", className);
  return as === "group" ? (
    <div role="group" aria-labelledby={titleId} className={frame}>
      {body}
    </div>
  ) : (
    <section aria-labelledby={titleId} className={frame}>
      {body}
    </section>
  );
}

export default ChatCard;

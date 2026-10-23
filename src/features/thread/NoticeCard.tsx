import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// 안내 카드의 틀(three-axes 티켓 22) — 캔버스의 한 틀이다(DS `.at-approval` — r28 · 컴포저 면과 그림자 · 위에 엔진 줄 · 제목 · 대상 ·
// 까닭, 아래 단추 줄). 카드마다 다른 것은 위 칸의 글과 아래 줄(`children`)뿐이다. 승인 카드도 이 틀을 썼으나 v1 티켓 24부터 제 모양
// (Cards · Approval 보드 A안 — 얼굴 · Policy · 번호 줄)이다(`ApprovalCard`).
//
// 카드의 주 동작은 검정 면이다(캔버스 `.cx-split` · `.cx-btn.primary`) — 앱의 주 버튼(`Button` default)이 Codex primary(`fg` 면 ·
// `fg-inverse` 글자)라 덮을 것이 없다. 한때 앱의 주 버튼이 파랑이라 카드가 그 면을 덮었다.

interface NoticeCardProps {
  titleId: string;
  /** 엔진 줄 — 아이콘 하나와 글. */
  icon: LucideIcon;
  head: string;
  title: string;
  /** 명령 · 경로 · 설치 명령 같은 대상 — 고정폭 상자에 선다. 없으면 서지 않는다. */
  subject?: string | null;
  /** 까닭 줄 — 없으면 서지 않는다. */
  reason?: string | null;
  /** 거절된 명령의 글 — 카드 안에 알림으로 선다(엔진의 거절은 화면에 보일 글이다). */
  problem: string | null;
  className?: string;
  /** 아래 줄들 — 칩 줄 · 단추 줄. */
  children: ReactNode;
}

/** 안내 카드는 Thread 본문 자리의 구획(`section`)이다. */
function NoticeCard({ titleId, icon: Icon, head, title, subject, reason, problem, className, children }: NoticeCardProps) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn("flex flex-col rounded-composer bg-surface-composer shadow-composer", className)}
    >
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <span className="flex items-center gap-1.5 text-xs text-fg-tool">
          <Icon className="size-3.5" aria-hidden />
          {head}
        </span>
        <p id={titleId} className="break-keep text-sm font-medium text-fg">
          {title}
        </p>
        {subject && (
          <pre className="whitespace-pre-wrap break-all rounded-md bg-fill-soft p-2 font-mono text-xs font-medium text-fg-secondary">
            {subject}
          </pre>
        )}
        {reason && <p className="break-keep text-xs text-fg-tool">{reason}</p>}
        {problem && (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export default NoticeCard;

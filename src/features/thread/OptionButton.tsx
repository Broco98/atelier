import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { AskButton } from "./AskCard";

/**
 * 대화 속 카드의 글자 단추(ChatCards · Cards 보드 `.ra-opt` · restart 02b-6) — PR 카드의 「변경 사항 보기」 · 「GitHub에서 열기 ↗」 · 「고쳐 달라고
 * 하기」, 결과 카드의 「열기」가 쓴다. **사람의 답을 기다리는 카드의 왼쪽 옅은 알약(`AskButton`의 `opt`)과 한 단추다** — 28 알약 · 좌우 12 · 13 / 18 ·
 * 400 글자에 안쪽 1 `border-heavy` 링, 가리키면 `fill-soft`, 포커스 링 · 꺼짐(50%, 가리켜도 면이 서지 않는다)이 한 벌이다. 한때 앱 `Button`의
 * outline으로 따로 지어 꺼짐이 포인터를 막았다(결과 카드의 「그사이 사라졌어요」 툴팁이 서지 않았다). 이 단추만의 것은 둘이다: 글자색은 놓인 자리를
 * 따르고(PR 카드의 실패 칸에서는 `fg-secondary`), 끝 글리프(부르는 자리가 단다 — 12 · `fg-tertiary`)와의 사이가 4다.
 */
export function OptionButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <AskButton tone="opt" className={cn("gap-1 text-inherit", className)} {...props} />;
}

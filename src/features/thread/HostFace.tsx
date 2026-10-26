import { cn } from "@/lib/utils";

// Host의 얼굴(캔버스 Screen-Home · Messages 보드) — 둥근 네모(24 격자의 모서리 8)에 세로 눈 둘이다. 면은 글자색(`fg`), 눈은 바탕색이라
// 다크에서도 뒤집혀 선다(보드의 `--host` · `--host-eye`). 크기만 자리마다 다르다 — 빈 Thread 44 · 이름 줄 20 · 칩 16. 그림일 뿐이라
// 숨는다 — 이름은 곁의 글자가 말한다. 다른 Agent의 얼굴(모양 · 색, S36)은 14가 더한다.
function HostFace({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
      <rect width="24" height="24" rx="8" className="fill-fg" />
      <rect x="8" y="8.5" width="2.2" height="4.6" rx="1.1" className="fill-surface" />
      <rect x="13.8" y="8.5" width="2.2" height="4.6" rx="1.1" className="fill-surface" />
    </svg>
  );
}

export default HostFace;

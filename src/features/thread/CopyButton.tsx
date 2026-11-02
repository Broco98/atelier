import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** 복사한 뒤 ✓가 서 있는 시간 — 토스트 한 장의 수명과 같다(`TOAST_TIMEOUT_MS`, 원본 mermaid 코드 복사와 같은 박자). */
const COPIED_MS = 1600;

/**
 * 대화의 복사 단추(restart 02b-6 · Cards 보드 `.ra-ic-btn` · 스토리 72) — 내 말(말 머리) · 답(답 아래 줄) · 코드 블록(머리 오른쪽)이 쓴다. 26 ·
 * 둥근 8 · 글리프 14 · `fg-tertiary`, 호버는 `fill-hover` 면과 `fg` 글자다. 누르면 글을 클립보드에 쓰고 글리프가 잠깐 ✓로 바뀐다 — 대화에는
 * 토스트 자리가 없다.
 */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
      className={cn("icon-button-quiet icon-button-sm text-fg-tertiary focus-ring", className)}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

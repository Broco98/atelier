import { useEffect, useId, useMemo, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const zoomButton =
  "flex h-[22px] min-w-[22px] items-center justify-center rounded-[7px] px-1 text-[12px] text-tertiary transition-colors hover:bg-accent hover:text-foreground";

function ZoomControls({
  scale,
  onChange,
  max,
}: {
  scale: number;
  onChange: (scale: number) => void;
  max: number;
}) {
  return (
    <>
      <button type="button" onClick={() => onChange(Math.max(0.4, scale - 0.2))} className={zoomButton}>−</button>
      <button type="button" onClick={() => onChange(1)} className={zoomButton}>{Math.round(scale * 100)}%</button>
      <button type="button" onClick={() => onChange(Math.min(max, scale + 0.2))} className={zoomButton}>+</button>
    </>
  );
}

interface SvgSize {
  w: number;
  h: number;
}

// mermaid가 만든 svg 문자열에서 viewBox 크기를 읽는다 — mermaid 11은 항상 viewBox를 넣는다
function svgSize(svg: string): SvgSize | null {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

// transform 대신 래퍼에 viewBox × scale 크기를 명시 — 레이아웃 크기 = 보이는 크기가 되어
// overflow-auto 스크롤·드래그 팬이 실제 콘텐츠와 어긋나지 않는다 (svg는 벡터라 무손실 확대)
function SizedSvg({ svg, size, scale }: { svg: string; size: SvgSize | null; scale: number }) {
  if (!size) {
    // viewBox 없는 예외 svg — 기존 transform 방식으로 폴백
    return (
      <div
        style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <div
      style={{ width: size.w * scale, height: size.h * scale }}
      className="[&>svg]:h-full! [&>svg]:w-full! [&>svg]:max-w-none!"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [showCode, setShowCode] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [fullScale, setFullScale] = useState(1);

  const size = useMemo(() => (svg ? svgSize(svg) : null), [svg]);

  useEffect(() => {
    let on = true;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "neutral" });
      try {
        const { svg } = await mermaid.render(`mm${id}`, code);
        if (on) setSvg(svg);
      } catch (e) {
        // 파싱 실패는 숨기지 않고 코드로 폴백한다
        if (on) setError(String(e));
      }
    });
    return () => {
      on = false;
    };
  }, [code, id]);

  useEffect(() => {
    if (!fullOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullOpen]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="overflow-hidden rounded-[12px] border bg-panel" onClick={stop}>
      <div className="flex items-center justify-between border-b px-2.5 py-1.5">
        <span className="font-mono text-[11px] text-tertiary">mermaid</span>
        <span className="flex items-center gap-1">
          <ZoomControls scale={scale} onChange={setScale} max={2.4} />
          <span className="mx-1 h-3.5 w-px bg-border" />
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            title="원본 mermaid 코드 보기"
            className={cn(zoomButton, showCode && "bg-accent text-foreground")}
          >
            코드
          </button>
          <button type="button" onClick={() => setFullOpen(true)} title="전체화면으로 크게 보기" className={zoomButton}>
            <Maximize2 className="size-3" strokeWidth={2} />
          </button>
        </span>
      </div>
      {error && !svg ? (
        <div className="flex flex-col gap-2 p-4">
          <span className="text-[12.5px] text-red-600">다이어그램 렌더링 실패 — 원본 코드를 표시해요</span>
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-muted-foreground">{code}</pre>
        </div>
      ) : showCode ? (
        <pre className="overflow-x-auto bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.75] text-muted-foreground">{code}</pre>
      ) : (
        <div className="overflow-auto p-4">
          {svg ? (
            <SizedSvg svg={svg} size={size} scale={scale} />
          ) : (
            <span className="text-[12.5px] text-tertiary">렌더링 중…</span>
          )}
        </div>
      )}

      {fullOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-9"
          onClick={() => setFullOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-[14px] border border-border-strong bg-background shadow-lg"
            onClick={stop}
          >
            <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5">
              <span className="font-mono text-[12px] text-tertiary">mermaid</span>
              <span className="flex items-center gap-1">
                <ZoomControls scale={fullScale} onChange={setFullScale} max={3} />
                <button
                  type="button"
                  onClick={() => setFullOpen(false)}
                  title="닫기 (Esc)"
                  className="ml-1 flex size-[26px] items-center justify-center rounded-[9px] text-tertiary transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-7">
              {svg && <SizedSvg svg={svg} size={size} scale={fullScale} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MermaidBlock;

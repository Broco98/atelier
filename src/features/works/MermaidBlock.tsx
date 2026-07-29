import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import FullscreenModal from "./FullscreenModal";

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

// 원본 mermaid 코드 복사 — MermaidBlock엔 토스트가 없으므로 버튼 자체가 1.6초간 체크로 피드백한다
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" onClick={onCopy} title="원본 mermaid 코드 복사" className={zoomButton}>
      {copied ? (
        <Check className="size-3 text-green-700" strokeWidth={2.4} />
      ) : (
        <Copy className="size-3" strokeWidth={2} />
      )}
    </button>
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

// 드래그로 overflow 컨테이너를 스크롤하는 팬 — pointer capture로 컨테이너 밖으로 나가도 이어진다
function usePanScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !ref.current) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: ref.current.scrollLeft,
      top: ref.current.scrollTop,
    };
    ref.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return;
    ref.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    ref.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
  };
  return { ref, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
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
  const pan = usePanScroll();
  const modalPan = usePanScroll();

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

  // 참조가 안정적이어야 모달의 Escape 리스너가 렌더마다 붙었다 떼이지 않는다
  const close = useCallback(() => setFullOpen(false), []);

  // 모달이 열리면 다이어그램이 화면에 꽉 맞는 배율로 시작한다 (svg 도착 전에 열렸으면 size 갱신 때 재계산)
  useLayoutEffect(() => {
    const el = modalPan.ref.current;
    if (!fullOpen || !el || !size) return;
    const pad = 56; // 모달 콘텐츠 p-7 좌우·상하 패딩 합
    const fit = Math.min((el.clientWidth - pad) / size.w, (el.clientHeight - pad) / size.h);
    setFullScale(Math.min(3, Math.max(0.4, fit)));
  }, [fullOpen, size, modalPan.ref]);

  return (
    <div className="overflow-hidden rounded-[12px] border bg-panel">
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
          <CopyCodeButton code={code} />
          <button type="button" onClick={() => setFullOpen(true)} title="전체화면으로 크게 보기" className={zoomButton}>
            <Maximize2 className="size-3" strokeWidth={2} />
          </button>
        </span>
      </div>
      {error && !svg ? (
        <div className="flex flex-col gap-2 p-4">
          <span className="text-[12.5px] text-red-600">다이어그램 렌더링 실패 — 원본 코드를 표시해요</span>
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-muted-foreground scroll-quiet">{code}</pre>
        </div>
      ) : showCode ? (
        <pre className="overflow-x-auto bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.75] text-muted-foreground scroll-quiet">{code}</pre>
      ) : (
        <div {...pan} className="cursor-grab select-none overflow-auto p-4 active:cursor-grabbing scroll-quiet">
          {svg ? (
            <SizedSvg svg={svg} size={size} scale={scale} />
          ) : (
            <span className="text-[12.5px] text-tertiary">렌더링 중…</span>
          )}
        </div>
      )}

      {fullOpen && (
        <FullscreenModal
          label="mermaid"
          onClose={close}
          controls={
            <>
              <ZoomControls scale={fullScale} onChange={setFullScale} max={3} />
              <CopyCodeButton code={code} />
            </>
          }
        >
          <div {...modalPan} className="min-h-0 flex-1 cursor-grab select-none overflow-auto p-7 active:cursor-grabbing scroll-quiet">
            {svg && <SizedSvg svg={svg} size={size} scale={fullScale} />}
          </div>
        </FullscreenModal>
      )}
    </div>
  );
}

export default MermaidBlock;

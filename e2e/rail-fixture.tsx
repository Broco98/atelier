import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FileText, Files, Zap } from "lucide-react";
import { Card, CardHead, Frame } from "@/components/shell/Frame";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, WORK_PANEL_WIDTH } from "@/components/shell/panel-layout";
import { PanelBody, pickRail, type RailItem } from "@/components/shell/Rail";
import useResizableWidth from "@/components/shell/useResizableWidth";
import { TooltipProvider } from "@/components/ui/tooltip";

// **레일의 진열대** — 칸이 둘인 레일(codex-ds 결정 25 · 29 · DS `PanelRail`)을 L3가 칠해진 값으로 재려고 세운다(`rail.spec.ts`). 세울
// 때 앱의 작업 화면은 레일 칸이 `spec` 하나라 레일이 서지 않았다(codex-ds 티켓 18) — 그래서 시험용 둘째 칸 `files`(git-integration이
// 더할 칸의 이름이다 — DS `PanelRail`)를 여기서만 든다. 지금은 앱에도 `files`가 더해져 레일이 서고, 그 자리는 `frame.spec.ts`가
// 잰다. 진열대는 레일의 모양 · 고르는 규칙을 앱의 데이터(트리 · 문서) 없이 따로 재는 자리로 남는다.
//
// 앱이 이 파일을 들이지 않는다. 검사가 앱 화면 위에서 Vite dev 서버로 들인다(`page.addScriptTag`의 모듈 스크립트가
// `/e2e/rail-fixture.tsx`를 `import`한다 — `menu-fixture.tsx`와 같은 길). 그래서 같은 React · 같은 공용 틀(`Frame`) · 같은 `index.css`가
// 칠한다. 들이는 것은 앱이 이미 들이는 묶음(`react-dom` · `lucide-react` · Base UI 툴팁)과 앱의 소스뿐이라 Vite가 의존성을 다시 묶지
// 않는다.
//
// 진열대는 **작업 화면의 짜임 그대로**다 — 공용 틀에 머리 카드 · 본문 카드 · 작업 패널 칸 · 레일을 건네고, 열림과 고른 칸은
// 진열대가 들며 칸을 고른 뒤의 둘은 작업 화면과 같은 규칙(`pickRail`)이 정한다. 패널의 몸도 작업 화면과 같은 상자(`PanelBody`)로
// 칸마다 하나씩 서고, 기본 폭도 작업 패널의 것(`WORK_PANEL_WIDTH`)이다. 그래서 레일의 자리(카드 위끝 · 틈) · 모양 · 누름과 패널 토글의
// 자리 · 몸의 숨김이 앱과 같은 코드로 선다.

type RailView = "spec" | "files";

const TWO_VIEWS: readonly RailItem<RailView>[] = [
  { id: "spec", label: "spec", icon: FileText },
  { id: "files", label: "files", icon: Files },
];

/**
 * 몸 하나에 선 접는 것 — 펼침을 제 상태로 든다. 칸을 다녀온 뒤에도 접어 둔 그대로인지가 「안 보이는 몸도 마운트된 채다」를 보인다
 * (`PanelBody` · ui-refresh 결정 9 — 작업 화면에서는 spec 트리의 폴더 접힘이다). Tab 정류장이다(`tabIndex` — WebKit의 Tab은 맨
 * `<button>`에 서지 않는다) — 창의 Tab이 패널을 지나 레일로 가는 차례를 `keyboard.spec`이 이 진열대에서 잰다.
 */
function Fold({ name }: { name: string }) {
  const [open, setOpen] = useState(true);
  return (
    <button type="button" aria-expanded={open} tabIndex={0} onClick={() => setOpen((now) => !now)}>
      {name} 폴더
    </button>
  );
}

function RailShowcase() {
  const [state, setState] = useState<{ open: boolean; active: RailView }>({ open: true, active: "spec" });
  const size = useResizableWidth("rail-fixture-panel-width", WORK_PANEL_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, "right");
  return (
    <Frame
      sidebarOpen
      head={{ icon: Zap, name: "진열대" }}
      rail={{
        items: TWO_VIEWS,
        active: state.active,
        onPick: (id) => setState((now) => pickRail(now, id)),
      }}
      panel={{
        open: state.open,
        onToggle: () => setState((now) => ({ ...now, open: !now.open })),
        size,
        label: "진열대 패널",
        children: (
          <>
            <CardHead>
              <span>{state.active}</span>
            </CardHead>
            {TWO_VIEWS.map(({ id }) => (
              <PanelBody key={id} view={id} shown={state.active === id}>
                <Fold name={id} />
              </PanelBody>
            ))}
          </>
        ),
      }}
    >
      <Card label="진열대 본문" className="flex-1">
        <span />
      </Card>
    </Frame>
  );
}

/**
 * 진열대를 `body` 끝에 세운다 — 창 전체를 덮는다(`position: fixed` · `inset: 0`). 앱 화면 위라 `index.css`가 이미 서 있고, 진열대의
 * 틀은 사이드바가 열린 갈래라(`sidebarOpen`) 왼쪽 여백이 없다. 검사는 이 상자(`data-rail-fixture`) 안에서만 집는다 — 그 아래 앱
 * 화면에도 `header` · `aside`가 있다.
 */
export function 레일진열대를세운다(): void {
  const holder = document.createElement("div");
  holder.dataset.railFixture = "";
  holder.style.cssText = "position: fixed; inset: 0; z-index: 60; display: flex;";
  document.body.appendChild(holder);
  createRoot(holder).render(
    <TooltipProvider>
      <RailShowcase />
    </TooltipProvider>,
  );
}

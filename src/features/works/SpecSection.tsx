import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SpecTree, { COLLAPSE_ROW, FolderGlyph, treeIndent } from "./SpecTree";
import { splitSpecFiles } from "./spec-sections";

interface SpecSectionProps {
  files: string[];
  current: string | null;
  onSelect: (path: string) => void;
  // spec 폴더 기준 상대 경로를 받는다 — 참조 문자열 조립은 호출부가 한다.
  // 이 영역은 어느 work의 문서인지 알 필요가 없다.
  onCopy: (path: string) => void;
}

// 작업 패널의 spec 탭 — 파일 트리 하나다. 머리글은 바로 위 탭 버튼이 이미 `spec`이라
// 없앴다(결정 23).
//
// 판이 쌓이면 어디가 지금인지 안 보이던 것을 **판 구획 + 상시 구획**으로 가른다.
// 접힘 섹션이라 두 판을 나란히 펼쳐 훑을 수 있다 — 팝오버는 본문을 가리고 하나만
// 고르게 강요해서 기각했다(결정 1).
//
// **돌려주는 스크롤 영역이 패널 카드의 직계 flex 자식이어야 한다** — 그것이 계약이다.
// 탭 바는 카드에 고정되고 트리만 세로로 스크롤한다. 한 겹 감싸면 flex-1이 카드가 아니라
// 그 껍데기를 기준으로 잡혀 경계가 옮겨가고, 카드의 넘침 감춤에 트리가 잘린다.
// 호출부의 탭 껍데기가 display:contents인 이유가 그것이다.
function SpecSection({ files, current, onSelect, onCopy }: SpecSectionProps) {
  const { iterations, standing } = useMemo(() => splitSpecFiles(files), [files]);

  // 접힘은 트리의 폴더 접힘과 **같은 계약**이다 — 리마운트(패널 토글)를 넘어 살지
  // 않는다. 그래서 여기 useState에 산다. **작업 전환은 결정 49 이후 리마운트가
  // 아니므로 접힘이 유지된다** — 접힘 기억의 키가 판 폴더의 전체 이름이라 대부분은
  // 기억에 없는 이름이고, 그래서 아래 기본값(최신 판만 펼침)으로 뜬다.
  //
  // 손으로 토글한 것만 기억하고 기본값은 계산으로 낸다. 판이 새로 생겼을 때 그것이
  // 자동으로 "펼쳐진 최신 판"이 되려면, 초기값을 한 번 굳혀 두면 안 된다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [sectionOpen, setSectionOpen] = useState(true);
  const [standingOpen, setStandingOpen] = useState(true);
  const latest = iterations[0]?.dir;
  const setIterationOpen = (dir: string, open: boolean) =>
    setToggled((prev) => ({ ...prev, [dir]: open }));

  return (
    // 세로 스크롤은 여기까지 — 탭 바는 패널 카드에 고정되어 항상 보인다
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      {files.length === 0 ? (
        <span className="px-2 py-1.5 text-[12.5px] text-tertiary">아직 spec 파일이 없어요</span>
      ) : (
        <>
          {/* 판이 하나도 없는 Work가 대부분이다(리서치만 하는 Work는 앞으로도 그렇다).
              그때는 구획을 아예 그리지 않아 지금까지와 똑같이 보인다. */}
          {iterations.length > 0 && (
            <>
              <CollapseSection
                label="Iterations"
                count={iterations.length}
                open={sectionOpen}
                onOpenChange={setSectionOpen}
                depth={0}
              >
                {iterations.map((iteration) => {
                  const prefix = `${iteration.dir}/`;
                  return (
                    // 폴더 이름을 그대로 보여준다 — 경로 복사가 붙어 있는 자리라
                    // 화면의 이름이 디스크의 이름과 어긋나면 안 된다
                    <CollapseSection
                      key={iteration.dir}
                      label={iteration.dir}
                      open={toggled[iteration.dir] ?? iteration.dir === latest}
                      onOpenChange={(open) => setIterationOpen(iteration.dir, open)}
                      depth={1}
                      // 아이콘은 트리와 **같은 출처**에서 온다. 판 폴더 이름을 그대로
                      // 넘기므로 트리에서 접혀 있을 때와 같은 글리프가 선다.
                      glyph={<FolderGlyph name={iteration.dir} />}
                    >
                      <SpecTree
                        files={iteration.files}
                        // 트리는 판 안 경로만 안다. 선택 표시도 같은 기준으로 맞춘다
                        current={current?.startsWith(prefix) ? current.slice(prefix.length) : null}
                        onSelect={(path) => onSelect(prefix + path)}
                        onCopy={(path) => onCopy(prefix + path)}
                        depth={2}
                      />
                    </CollapseSection>
                  );
                })}
              </CollapseSection>
              {standing.length > 0 && <div className="mx-2 my-1.5 h-px bg-border" />}
            </>
          )}
          {/* 상시 문서도 접힌다 — 결정 1은 두 구획 **모두** 접힌다고 말한다.
              다만 판이 하나도 없는 Work에서는 머리글을 그리지 않는다: 가를 상대가 없는데
              구획 이름만 서면 지금까지 보던 화면에 없던 층이 하나 생긴다. */}
          {standing.length > 0 &&
            (iterations.length > 0 ? (
              <CollapseSection
                label="Documents"
                open={standingOpen}
                onOpenChange={setStandingOpen}
                depth={0}
              >
                <SpecTree
                  files={standing}
                  current={current}
                  onSelect={onSelect}
                  onCopy={onCopy}
                  depth={1}
                />
              </CollapseSection>
            ) : (
              <SpecTree files={standing} current={current} onSelect={onSelect} onCopy={onCopy} />
            ))}
        </>
      )}
    </div>
  );
}

// 구획과 판 하나 — 머리글과 그 아래 줄들. 머리글은 트리의 폴더 행과 **같은 규격을 읽는다**(COLLAPSE_ROW) —
// 한 화면에서 접히는 것들이 서로 다르게 생기면 안 된다.
//
// 펼침은 트리의 폴더와 같이 **끊어서** 바꾼다. 사이드바 목록의 구역은 높이를 애니메이션하지만
// 그건 한 화면에 늘 보이는 두 구역이 서로 밀고 당기는 자리이고, 여기는 트리 안이라
// 폴더 접힘과 같은 박자여야 한다.
//
// 그래서 폴더와 같은 Collapsible 기본 변형이다(판 4, 스토리 114) — 머리글이 트리거라 `aria-expanded`를
// 스스로 달고, 줄들은 패널이라 닫히면 언마운트된다. 뿌리와 패널이 상자 둘을 세운다. 둘 다 세로 flow라
// 줄이 서는 자리는 그대로이고(실측), 스크롤 상자의 직계 자식이 구획마다 하나로 준다. 달라진 것은 하나다 —
// 트리가 넘칠 때 스크롤 상자의 직계 자식이던 `Iterations`·`Documents` 머리글이 flex 줄어듦에 눌려
// 18.8px이 되던 것이, 뿌리 안에 들어가 제 28px을 지킨다.
function CollapseSection({
  label,
  count,
  open,
  onOpenChange,
  depth,
  glyph,
  children,
}: {
  label: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  depth: number;
  glyph?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col">
      <CollapsibleTrigger className={COLLAPSE_ROW} style={treeIndent(depth)}>
        {/* 트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
            독립 rotate 속성을 써서, transform만 걸면 화살표가 뚝 끊긴다
            (SidebarWorkList가 같은 자리에서 같은 사실을 적고 있다) */}
        <ChevronRight
          className={cn("size-3 shrink-0 transition-[rotate] duration-150", open && "rotate-90")}
          strokeWidth={2.2}
        />
        {glyph}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 pr-2 text-[11px] tabular-nums">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default SpecSection;

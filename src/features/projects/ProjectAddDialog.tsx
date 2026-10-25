import { useEffect, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { Book, ChevronDown, Folder, FolderPlus, GitBranch, Lightbulb, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogOverlay, DialogPopup, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { projectAddStore } from "./add-store";
import { projectsApi } from "./api";
import { useCreateProject, useMakeProject, useNewProjectParent, useSaveNewProjectParent } from "./hooks";
import { addView, pickFolder, typeName, unpickFolder, type AddDraft, type AddMode, type AddNotice, type AddView, type NoticeAct } from "./project-add";
import type { ProjectView } from "./types";

// Project 추가 창(03 구현 스펙 §16 · 캔버스 v52 F1-ProjectAdd · F1-ProjectNew · F4-ProjNoGit · F4-KitProject 「추가 창 — 소스 폴더」). 「Project
// 이름」 칸 · 「소스 폴더」 스위치와 그 칸 · 아래 안내 · 오른쪽 아래 단추다. 무엇을 보일지는 `project-add.ts`가 고르고, 여기는 그리고 부른다.
//
// - **앱에 하나다** — 앱 루트(`AppShell`)에 서고, 여는 길(Projects 「Project 추가」 · 끌어 놓기 · Space 상세 · 범위 줄)은 모두
//   `addProject`(`add-store.ts`)다. 끝나면 추가한 Project가 그 길로 돌아간다.
// - 폴더를 고르는 순간 core가 살핀다(`inspect_project_folder`). 「새로 만들기」는 이름을 칠 때마다 그 자리를 묻는다(`new_project_place`).
// - 실패(git이 이름 · 이메일이 없어 첫 커밋을 못 한 것 같은)는 창 안에 그 글 그대로 선다 — 창을 닫지 않고 고쳐 다시 누른다.

const NAME_ID = "project-add-name";

/** 앱 루트에 하나 서는 추가 창 — 스토어에 물음이 서면 열린다. 닫기 · Esc · 바깥은 「닫음」(null)으로 끝난다. */
export default function ProjectAddDialog() {
  const ask = useStore(projectAddStore, (state) => state);
  return (
    <Dialog
      open={ask !== null}
      onOpenChange={(open) => {
        if (!open) projectAddStore.state?.done(null);
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        {/* 창 상자(시안 `.dlg` — 위 120 · 폭 520 · 모서리 20 · 안쪽 20/18/18 · 칸 사이 18). 첫 포커스는 이름 칸이다. 가운데 창의
            세로 가운데 맞춤(`-translate-y-1/2`)을 풀어 위에서 120에 선다 — 갈래가 바뀌어도 창 위 끝이 움직이지 않는다. */}
        <DialogPopup
          showCloseButton={false}
          aria-label="Project 추가"
          initialFocus={() => document.getElementById(NAME_ID)}
          className="top-30 flex w-130 max-w-[calc(100%-4rem)] translate-y-0 flex-col gap-4.5 rounded-3xl px-4.5 pt-5 pb-4.5 shadow-modal"
        >
          {ask && <AddBody seq={ask.seq} folder={ask.folder} done={ask.done} />}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function AddBody({ seq, folder, done }: { seq: number; folder: string | null; done: (added: ProjectView | null) => void }) {
  const navigate = useNavigate();
  const parent = useNewProjectParent();
  const saveParent = useSaveNewProjectParent();
  const create = useCreateProject();
  const make = useMakeProject();
  const blank: AddDraft = { mode: "folder", name: "", named: false, folder: null };
  const [draft, setDraft] = useState<AddDraft>(() => (folder ? pickFolder(blank, folder) : blank));
  const [failed, setFailed] = useState<string | null>(null);

  // 떠 있는 창에 폴더를 끌어 놓았다 — 그 폴더로 바꿔 선다(이름은 사람이 친 것이면 그대로다).
  const seen = useRef(seq);
  useEffect(() => {
    if (seq === seen.current) return;
    seen.current = seq;
    if (folder) setDraft((now) => pickFolder({ ...now, mode: "folder" }, folder));
  }, [seq, folder]);

  const look =
    useQuery({
      queryKey: ["project-folder", draft.folder],
      queryFn: () => projectsApi.inspect(draft.folder ?? ""),
      enabled: draft.mode === "folder" && draft.folder !== null,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }).data ?? null;
  // 이름을 칠 때마다 묻는다 — 답이 오는 사이에는 앞 답으로 선다(자리 줄이 「이름」으로 깜빡이지 않게).
  const place =
    useQuery({
      queryKey: ["project-place", parent, draft.name.trim()],
      queryFn: () => projectsApi.place(parent, draft.name),
      enabled: draft.mode === "new",
      placeholderData: keepPreviousData,
      staleTime: 0,
      retry: false,
    }).data ?? null;
  const view = addView(draft, look, place, parent);
  const busy = create.isPending || make.isPending;

  const change = (next: (now: AddDraft) => AddDraft) => {
    setFailed(null);
    setDraft(next);
  };
  const pick = async () => {
    const picked = await openFolderPicker({ directory: true, title: "Project로 추가할 폴더" });
    if (typeof picked === "string") change((now) => pickFolder(now, picked));
  };
  const relocate = async () => {
    const picked = await openFolderPicker({ directory: true, title: "새 Project를 만들 위치" });
    if (typeof picked === "string") saveParent.mutate(picked);
  };
  const act = (what: NoticeAct) => {
    if (what === "root" && look?.kind === "subfolder") change((now) => pickFolder(now, look.root));
    if (what === "add-folder" && place?.path) {
      const there = place.path;
      change((now) => pickFolder({ ...now, mode: "folder" }, there));
    }
    if (what === "open" && look?.kind === "registered") {
      done(null);
      void navigate({ to: "/projects/$slug", params: { slug: look.project.slug } });
    }
  };
  const submit = async () => {
    if (!view.submit.enabled || busy) return;
    setFailed(null);
    const name = draft.name.trim();
    try {
      if (view.submit.act === "new") done(await make.mutateAsync({ parent, name }));
      else if (look) done(await create.mutateAsync({ folder: look.path, name, initGit: view.submit.act === "init" }));
    } catch (error) {
      setFailed(`${view.submit.act === "new" ? "만들지 못했어요" : "추가하지 못했어요"} — ${error}`);
    }
  };

  return (
    <>
      {/* 머리 — 제목(시안 17/600 — 앱 창 제목 단계 16)과 닫기. */}
      <div className="flex items-center gap-2">
        <DialogTitle>Project 추가</DialogTitle>
        <DialogClose render={<Button variant="ghost" size="icon" className="ml-auto" aria-label="닫기" />}>
          <X aria-hidden />
        </DialogClose>
      </div>

      {/* 「Project 이름」 — 36 칸 · 모서리 10 · 앞에 폴더 글리프. 비어 있으면 고른 폴더 이름으로 채운다(스토리 106). Enter는 오른쪽 아래 단추다. */}
      <div className="flex flex-col gap-2">
        <label htmlFor={NAME_ID} className="text-sm text-fg">
          Project 이름
        </label>
        <InputGroup className="h-9 gap-2.5 bg-surface px-3 inset-ring inset-ring-border-heavy">
          <InputGroupAddon>
            <Folder className="size-4 text-fg-secondary" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            id={NAME_ID}
            placeholder="예: web-app"
            autoComplete="off"
            spellCheck={false}
            value={draft.name}
            onChange={(event) => change((now) => typeName(now, event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            className="text-sm"
          />
        </InputGroup>
      </div>

      {/* 「소스 폴더」 — 머리의 스위치와, 고른 갈래의 줄 · 안내 상자(시안 `.src` — 안쪽 16/14 · 줄 사이 12 · 가운데 맞춤). */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg">소스 폴더</span>
        <div className="flex min-h-25.5 flex-col items-center justify-center gap-3 rounded-lg px-3.5 py-4 inset-ring inset-ring-border-heavy">
          <ModeSwitch view={view} mode={draft.mode} onMode={(mode) => change((now) => ({ ...now, mode }))} />
          {draft.mode === "folder" && view.picked === null && (
            <Button variant="secondary" className="rounded-full px-3.5 text-sm" onClick={() => void pick()}>
              <FolderPlus className="size-4" aria-hidden />
              추가
            </Button>
          )}
          {view.picked && <PickedRow picked={view.picked} onUnpick={() => change(unpickFolder)} />}
          {view.place && <PlaceRow place={view.place} onRelocate={() => void relocate()} />}
          {view.notice && <Notice notice={view.notice} onAct={act} />}
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-chat-meta text-danger">
          {failed}
        </p>
      )}

      {/* 아래 안내(스토리 116) — Project · Space · Work의 관계를 처음에 안다. */}
      <div className="flex items-start gap-3 rounded-xl bg-fill-soft px-4 py-3.5 text-chat-meta break-keep text-fg-secondary">
        <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Project는 git 레포 하나예요. Space로 묶으면 Agent가 함께 읽고, Work는 고칠 Project에만 worktree를 만들어요.</span>
      </div>

      {/* 오른쪽 아래 단추 — 채우기 전엔 꺼져 있다(시안 회색). 36 둥근 큰 버튼이다. */}
      <div className="flex justify-end">
        <Button size="lg" className="px-4" disabled={!view.submit.enabled || busy} onClick={() => void submit()}>
          {view.submit.label}
        </Button>
      </div>
    </>
  );
}

/** 소스 폴더 머리 — 굵은 앞(「이 컴퓨터」 · 「새 폴더」)과 ⌄. 누르면 두 길(설명 · ✓)이 선다(시안 `.src-h` · 메뉴 340). */
function ModeSwitch({ view, mode, onMode }: { view: AddView; mode: AddMode; onMode: (mode: AddMode) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md text-sm text-fg-secondary focus-ring">
        <span>
          <span className="text-fg">{view.head[0]}</span>
          {view.head[1]}
        </span>
        <ChevronDown className="size-3 text-fg-icon" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="center" className="w-85">
        <DropdownMenuRadioGroup value={mode} onValueChange={(next: AddMode) => onMode(next)}>
          <DropdownMenuRadioItem
            value="folder"
            label="이 컴퓨터의 폴더 추가"
            aria-description="이미 있는 git 레포를 그대로 써요. 코드는 옮기지 않아요."
            size="note"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span>이 컴퓨터의 폴더 추가</span>
              <span className="text-xs text-fg-tertiary">이미 있는 git 레포를 그대로 써요. 코드는 옮기지 않아요.</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="new" label="새로 만들기" aria-description="빈 폴더를 만들고 git 레포로 시작해요." size="note">
            <span className="flex min-w-0 flex-1 flex-col">
              <span>새로 만들기</span>
              <span className="text-xs text-fg-tertiary">빈 폴더를 만들고 git 레포로 시작해요.</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 칸 안의 한 줄 상자(시안 `.pick` — 옅은 면 · 모서리 10 · 안쪽 10/8/10/12). 고른 폴더 줄과 새로 만들 자리 줄이 같이 쓴다. */
const ROW = "flex w-full items-center gap-2.5 rounded-lg bg-fill-soft py-2.5 pr-2 pl-3";

/** 고른 폴더 줄 — 경로 · 무엇인가 한 줄 · 기준 브랜치 · 빼기(×). */
function PickedRow({ picked, onUnpick }: { picked: NonNullable<AddView["picked"]>; onUnpick: () => void }) {
  return (
    <div className={ROW}>
      <Folder className="size-4 shrink-0 text-fg-secondary" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-xs text-fg">{picked.path}</span>
        {picked.found && <span className="truncate text-xs text-fg-tertiary">{picked.found}</span>}
      </span>
      {picked.branch && (
        // 기준 브랜치 — 추가하면 이것으로 선다. 고치는 자리는 상세다(core 추가는 기준 브랜치를 받지 않는다 — 03 §15).
        <span
          aria-label={`기준 브랜치 ${picked.branch}`}
          className="inline-flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-md px-2 font-mono text-xs text-fg inset-ring inset-ring-border-heavy"
        >
          <GitBranch className="size-3 shrink-0 text-fg-secondary" aria-hidden />
          <span className="truncate">{picked.branch}</span>
        </span>
      )}
      <Button variant="ghost" size="icon" aria-label="폴더 빼기" onClick={onUnpick}>
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

/** 새로 만들 자리 줄 — `<부모>/<폴더>`(이름이 없으면 흐린 「이름」) · 아래 한 줄 · 「위치 바꾸기」(스토리 112 · 115). */
function PlaceRow({ place, onRelocate }: { place: NonNullable<AddView["place"]>; onRelocate: () => void }) {
  return (
    <div className={ROW}>
      <FolderPlus className="size-4 shrink-0 text-fg-secondary" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-xs text-fg">
          {place.prefix}
          <span className={cn(place.folder === null && "text-fg-placeholder")}>{place.folder ?? "이름"}</span>
        </span>
        <span className="truncate text-xs text-fg-tertiary">{place.note}</span>
      </span>
      <Button variant="ghost" size="xs" onClick={onRelocate}>
        위치 바꾸기
      </Button>
    </div>
  );
}

/** 안내 상자(시안 `.ntc`) — 경고는 노랑 · 세모, 알림은 파랑 · 저장소 글리프. 단추가 있으면 오른쪽에 선다. */
function Notice({ notice, onAct }: { notice: AddNotice; onAct: (act: NoticeAct) => void }) {
  const warn = notice.tone === "warn";
  const Icon = warn ? TriangleAlert : Book;
  return (
    <div
      role="status"
      className={cn(
        "flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-chat-meta break-keep",
        warn ? "bg-notice-warn text-fg-notice-warn" : "bg-notice-info text-fg-notice-info",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", warn ? "text-fg-notice-warn-icon" : "text-accent-solid")} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{notice.title}</span>
        <span className="text-fg-secondary">{notice.body}</span>
      </span>
      {notice.action && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 self-center rounded-full bg-surface text-chat-meta text-fg"
          onClick={() => onAct(notice.action!.act)}
        >
          {notice.action.label}
        </Button>
      )}
    </div>
  );
}

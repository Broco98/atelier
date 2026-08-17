import type { ProjectView } from "@/features/projects/types";

// L3가 쓰는 고정 데이터는 여기 한 곳에만 있다. 테스트마다 제각각인 가짜 데이터가
// 생기면 무엇이 기대값인지가 테스트 수만큼 갈라진다.
export const PROJECTS: ProjectView[] = [
  {
    slug: "billing",
    name: "빌링",
    path: "~/dev/billing",
    baseBranch: "main",
    createdAt: "2026-01-02T03:04:05Z",
    description: "결제 도메인",
    git: { remoteSlug: "acme/billing", currentBranch: "main", localBranches: ["main"] },
    missing: false,
  },
  {
    slug: "ledger",
    name: "원장",
    path: "~/dev/ledger",
    baseBranch: "develop",
    createdAt: "2026-01-03T03:04:05Z",
    description: "",
    git: null,
    missing: false,
  },
];

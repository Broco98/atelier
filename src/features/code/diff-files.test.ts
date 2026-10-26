import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { baseContentsOf } from "./diff-files";

// 숨긴 줄 펼치기의 옛 글(v1 티켓 35) — `read_work_diff`의 patch는 바뀐 덩어리 둘레만 싣는다. 펼치려면 양쪽 파일 전체가 드는데, 새 쪽은
// worktree의 파일 그대로이고 옛 쪽은 그 파일에서 patch를 거꾸로 되돌려 짓는다. 재는 것은 되돌린 글이 base의 글과 글자까지 같은가다.

const base = [
  "import { Injectable } from '@nestjs/common';",
  "import { LedgerService } from '../ledger/ledger.service';",
  "",
  "export class RefundService {",
  "  async partialRefund(orderId: string, amount: number) {",
  "    const order = await this.orders.findById(orderId);",
  "    await this.ledger.debit(order.id, amount);",
  "    const left = order.total - amount;",
  "    return { left };",
  "  }",
  "",
  "  async fullRefund(orderId: string) {",
  "    return this.partialRefund(orderId, Infinity);",
  "  }",
  "}",
  "",
].join("\n");

const worktree = [
  "import { BadRequestException, Injectable } from '@nestjs/common';",
  "import { LedgerService } from '../ledger/ledger.service';",
  "",
  "export class RefundService {",
  "  async partialRefund(orderId: string, amount: number) {",
  "    const order = await this.orders.findById(orderId);",
  "    const refunded = order.refundedAmount;",
  "    const left = order.total - refunded - amount;",
  "    return { left };",
  "  }",
  "",
  "  async fullRefund(orderId: string) {",
  "    return this.partialRefund(orderId, Infinity);",
  "  }",
  "}",
  "",
].join("\n");

/** `git diff -U1 <base> -- src/refunds/refund.service.ts`가 낸 모양 — 덩어리 둘, 그 사이와 끝은 접혀 있다. */
const patch = `diff --git a/src/refunds/refund.service.ts b/src/refunds/refund.service.ts
index 3b18e51..a1f0c2d 100644
--- a/src/refunds/refund.service.ts
+++ b/src/refunds/refund.service.ts
@@ -1,2 +1,2 @@
-import { Injectable } from '@nestjs/common';
+import { BadRequestException, Injectable } from '@nestjs/common';
 import { LedgerService } from '../ledger/ledger.service';
@@ -6,4 +6,4 @@ export class RefundService {
     const order = await this.orders.findById(orderId);
-    await this.ledger.debit(order.id, amount);
-    const left = order.total - amount;
+    const refunded = order.refundedAmount;
+    const left = order.total - refunded - amount;
     return { left };
`;

const diffOf = (text: string) => parsePatchFiles(text)[0].files[0];

describe("숨긴 줄 펼치기의 옛 글", () => {
  it("worktree의 글에서 patch의 덩어리를 거꾸로 되돌리면 base의 글이 그대로 선다", () => {
    expect(baseContentsOf(worktree, diffOf(patch))).toBe(base);
  });

  it("줄을 지우기만 한 덩어리(새 쪽 0줄)도 그 자리에 옛 줄이 돌아온다", () => {
    const before = "하나\n둘\n셋\n넷\n";
    const after = "하나\n넷\n";
    const removed = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -2,2 +1,0 @@
-둘
-셋
`;
    expect(baseContentsOf(after, diffOf(removed))).toBe(before);
  });

  it("끝 줄에 줄바꿈이 없던 base도 글자까지 같다", () => {
    const before = "하나\n둘";
    const after = "하나\n둘\n셋\n";
    const added = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 하나
-둘
\\ No newline at end of file
+둘
+셋
`;
    expect(baseContentsOf(after, diffOf(added))).toBe(before);
  });

  it("worktree의 글이 patch와 어긋나면(diff를 읽은 뒤 다시 바뀌었다) 짓지 않고 던진다 — 틀린 옛 글로 펼치지 않는다", () => {
    const moved = worktree.replace("const refunded = order.refundedAmount;", "const refunded = order.refunded;");
    expect(() => baseContentsOf(moved, diffOf(patch))).toThrow("patch와 맞지 않아요");
  });
});

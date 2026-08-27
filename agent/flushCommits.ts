/// <reference types="node" />
/**
 * Project BADA — 대기 중인 커밋 강제 flush
 *
 * CI(GitHub Actions 등)에서 job 종료 직전 `if: always()`로 호출한다.
 * 자세한 이유는 agent/pipeline/goals.ts의 flushPendingCommits 주석 참고.
 *
 * 실행: npx tsx agent/flushCommits.ts
 */

import { flushPendingCommits, hasPushFailure } from "./pipeline/goals.js";

flushPendingCommits();

// flush가 push까지 마쳤는지 확인 — 커밋이 로컬에만 남았으면 job을 실패로 끝낸다.
// 이 스크립트는 `if: always()`로 job 마지막에 도는 별도 프로세스이므로
// loop.ts의 exit code와 별개로 여기서도 실패를 드러내야 한다.
if (hasPushFailure()) {
  console.log(`\n⚠ 커밋이 원격에 push되지 않았다 — 사람 개입 필요. exit 1`);
  process.exit(1);
}

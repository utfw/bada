/// <reference types="node" />
/**
 * Project BADA — 대기 중인 커밋 강제 flush
 *
 * CI(GitHub Actions 등)에서 job 종료 직전 `if: always()`로 호출한다.
 * 자세한 이유는 agent/pipeline/goals.ts의 flushPendingCommits 주석 참고.
 *
 * 실행: npx tsx agent/flushCommits.ts
 */

import { flushPendingCommits } from "./pipeline/goals.js";

flushPendingCommits();

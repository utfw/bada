/// <reference types="node" />
/**
 * Project BADA — 에이전트 비용·토큰 회계 리포트
 *
 * agent/logs/metrics.jsonl(loop.ts가 단계별로 append)을 읽어
 * stage별 비용/토큰/소요시간/성공률을 집계해 출력한다.
 *
 * 실행: npm run report            # 전체 누적
 *       npm run report -- <run>   # 특정 run(타임스탬프 디렉토리명)만
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const METRICS_FILE = path.join(ROOT, "agent", "metrics.jsonl");

interface MetricRecord {
  ts: string;
  run: string;
  goal: number;
  stage: string;
  attempt: number;
  success: boolean;
  rateLimited?: boolean; // 구버전 기록엔 없음 → undefined는 false로 취급
  durationMs: number;
  apiDurationMs: number;
  costUsd: number;
  in: number;
  out: number;
  cacheRead: number;
  cacheCreate: number;
  turns: number;
}

function loadRecords(runFilter?: string): MetricRecord[] {
  if (!fs.existsSync(METRICS_FILE)) {
    console.error(`metrics 파일이 없습니다: ${METRICS_FILE}`);
    console.error(`에이전트를 한 번 이상 실행(npm run agent)하면 생성됩니다.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(METRICS_FILE, "utf-8").split("\n").filter((l) => l.trim());
  const records: MetricRecord[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as MetricRecord;
      if (!runFilter || r.run === runFilter) records.push(r);
    } catch {
      // 깨진 줄은 건너뜀
    }
  }
  return records;
}

interface Agg {
  count: number;
  fails: number;
  rateLimits: number; // 한도 도달(인프라) — 코드 실패와 구분
  costUsd: number;
  durationMs: number;
  in: number;
  out: number;
  cacheRead: number;
  cacheCreate: number;
  turns: number;
}

function emptyAgg(): Agg {
  return { count: 0, fails: 0, rateLimits: 0, costUsd: 0, durationMs: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, turns: 0 };
}

function add(a: Agg, r: MetricRecord): void {
  a.count++;
  // 한도 도달은 코드 실패와 별도 집계 — fails는 순수 코드/리뷰 실패만 센다.
  if (r.rateLimited) a.rateLimits++;
  else if (!r.success) a.fails++;
  a.costUsd += r.costUsd;
  a.durationMs += r.durationMs;
  a.in += r.in;
  a.out += r.out;
  a.cacheRead += r.cacheRead;
  a.cacheCreate += r.cacheCreate;
  a.turns += r.turns;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function padL(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function printTable(title: string, rows: [string, Agg][]): void {
  console.log(`\n${title}`);
  console.log("─".repeat(96));
  const head = [
    pad("stage", 10),
    padL("n", 5),
    padL("fail", 5),
    padL("rl", 4),
    padL("fail%", 6),
    padL("cost", 11),
    padL("cost/n", 10),
    padL("in", 9),
    padL("out", 8),
    padL("cacheRd", 11),
    padL("avg s", 7),
  ].join("  ");
  console.log(head);
  console.log("─".repeat(96));
  for (const [name, a] of rows) {
    const failPct = a.count ? ((a.fails / a.count) * 100).toFixed(1) + "%" : "—";
    const costPer = a.count ? a.costUsd / a.count : 0;
    const avgSec = a.count ? (a.durationMs / a.count / 1000).toFixed(1) : "—";
    console.log(
      [
        pad(name, 10),
        padL(String(a.count), 5),
        padL(String(a.fails), 5),
        padL(String(a.rateLimits), 4),
        padL(failPct, 6),
        padL(fmtUsd(a.costUsd), 11),
        padL(fmtUsd(costPer), 10),
        padL(fmtNum(a.in), 9),
        padL(fmtNum(a.out), 8),
        padL(fmtNum(a.cacheRead), 11),
        padL(avgSec, 7),
      ].join("  ")
    );
  }
}

function main(): void {
  const runFilter = process.argv[2];
  const records = loadRecords(runFilter);

  if (records.length === 0) {
    console.log(runFilter ? `run '${runFilter}'에 해당하는 기록이 없습니다.` : "기록이 없습니다.");
    return;
  }

  const runs = new Set(records.map((r) => r.run));
  console.log(`\n${"═".repeat(96)}`);
  console.log(`📊 에이전트 비용·토큰 회계 — ${records.length}개 단계 기록 / ${runs.size}개 실행${runFilter ? ` (필터: ${runFilter})` : ""}`);
  console.log("═".repeat(96));

  // stage별 집계
  const byStage = new Map<string, Agg>();
  const total = emptyAgg();
  const retries = emptyAgg(); // attempt > 0 인 기록 = 재시도 비용
  for (const r of records) {
    if (!byStage.has(r.stage)) byStage.set(r.stage, emptyAgg());
    add(byStage.get(r.stage)!, r);
    add(total, r);
    if (r.attempt > 0) add(retries, r);
  }

  const stageOrder = ["plan", "impl", "review"];
  const stageRows: [string, Agg][] = [];
  for (const s of stageOrder) {
    if (byStage.has(s)) stageRows.push([s, byStage.get(s)!]);
  }
  for (const [s, a] of byStage) {
    if (!stageOrder.includes(s)) stageRows.push([s, a]);
  }
  stageRows.push(["TOTAL", total]);
  printTable("단계별 집계", stageRows);

  // 핵심 요약 수치 (AX 서사용)
  console.log(`\n${"─".repeat(96)}`);
  console.log("핵심 수치");
  console.log("─".repeat(96));
  const costPerRun = total.costUsd / runs.size;
  console.log(`  총 비용              ${fmtUsd(total.costUsd)}  (실행당 평균 ${fmtUsd(costPerRun)})`);
  console.log(`  총 토큰              in ${fmtNum(total.in)} / out ${fmtNum(total.out)} / cacheRead ${fmtNum(total.cacheRead)}`);
  if (total.in + total.cacheRead > 0) {
    const cacheHitPct = ((total.cacheRead / (total.in + total.cacheRead)) * 100).toFixed(1);
    console.log(`  캐시 적중률          ${cacheHitPct}%  (cacheRead / (in + cacheRead))`);
  }
  const failPct = ((total.fails / total.count) * 100).toFixed(1);
  console.log(`  코드 실패율          ${failPct}%  (${total.fails}/${total.count}, 리뷰 FAIL 등 — 한도 도달 제외)`);
  if (total.rateLimits > 0) {
    const rlPct = ((total.rateLimits / total.count) * 100).toFixed(1);
    console.log(`  한도 도달(인프라)    ${total.rateLimits}건 (${rlPct}%) — 코드 문제 아님, 재실행 필요`);
  }
  if (retries.count > 0) {
    const retryWastePct = ((retries.costUsd / total.costUsd) * 100).toFixed(1);
    console.log(`  재시도 비용          ${fmtUsd(retries.costUsd)}  (전체의 ${retryWastePct}%, 재시도 ${retries.count}회)`);
  } else {
    console.log(`  재시도 비용          없음`);
  }
  console.log("");
}

main();

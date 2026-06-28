/// <reference types="node" />
/**
 * Project BADA — 로깅·텔레메트리
 *
 * - AgentLog: 실행별 로그 디렉토리 생성, 단계 출력 파일 기록, metrics.jsonl 누적
 * - trimChecklistLog/readChecklistHash: REVIEW_CHECKLIST 변경 감지·트림
 * - formatMetrics: 단계 메트릭 한 줄 요약
 */

import * as fs from "fs";
import * as path from "path";
import {
  LOGS_DIR,
  METRICS_FILE,
  CHECKLIST_FILE,
  CHECKLIST_LOG_MAX_ENTRIES,
  type Stage,
  type StageMetrics,
} from "./types.js";

export function timestamp(): string {
  const d = new Date();
  return d.toISOString().replace(/[T]/g, "_").replace(/[:]/g, "-").split(".")[0];
}

export class AgentLog {
  private summaryLines: string[] = [];
  private runDir: string;
  private runId: string;

  constructor() {
    this.runId = timestamp();
    this.runDir = path.join(LOGS_DIR, this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });
    this.summaryLines.push(`# 에이전트 실행 로그 — ${new Date().toLocaleString("ko-KR")}\n`);
  }

  get directory(): string {
    return this.runDir;
  }

  // 단계별 토큰·비용·소요시간을 전역 누적 JSONL(metrics.jsonl)에 한 줄 append.
  // 콘솔로만 흘러가던 usage 데이터를 구조화 저장해 사후 회계/재현성 분석을 가능케 한다.
  metric(goalIndex: number, stage: Stage, attempt: number, success: boolean, rateLimited: boolean, m: StageMetrics): void {
    const record = {
      ts: new Date().toISOString(),
      run: this.runId,
      goal: goalIndex + 1,
      stage,
      attempt,
      success,
      // 인프라 한도(rate-limit/usage limit) 도달 — 코드 실패와 구분해 회계 신뢰성 확보.
      rateLimited,
      durationMs: m.durationMs,
      apiDurationMs: m.apiDurationMs,
      costUsd: m.costUsd,
      in: m.inputTokens,
      out: m.outputTokens,
      cacheRead: m.cacheReadTokens,
      cacheCreate: m.cacheCreationTokens,
      turns: m.numTurns,
    };
    fs.appendFileSync(METRICS_FILE, JSON.stringify(record) + "\n", "utf-8");
  }

  goalStart(goalText: string, index: number): void {
    this.summaryLines.push(`---\n`);
    this.summaryLines.push(`## 목표 ${index + 1}: ${goalText}\n`);
    this.summaryLines.push(`- 시작: ${new Date().toLocaleTimeString("ko-KR")}`);
  }

  stage(goalIndex: number, stage: Stage, attempt: number, output: string): void {
    const suffix = attempt === 0 ? "" : `-retry${attempt}`;
    const fileName = `goal-${String(goalIndex + 1).padStart(2, "0")}-${stage}${suffix}.md`;
    const filePath = path.join(this.runDir, fileName);
    const header = `# ${stage.toUpperCase()}${suffix} — 목표 ${goalIndex + 1}\n\n시각: ${new Date().toLocaleTimeString("ko-KR")}\n\n---\n\n`;
    fs.writeFileSync(filePath, header + output, "utf-8");
    this.summaryLines.push(`  - ${stage}${suffix}: [${fileName}](${fileName})`);
  }

  goalEnd(completed: boolean, changedFiles: string[]): void {
    this.summaryLines.push(`- 종료: ${new Date().toLocaleTimeString("ko-KR")}`);
    this.summaryLines.push(`- 결과: ${completed ? "✅ 완료" : "❌ 미완료"}`);

    if (changedFiles.length > 0) {
      this.summaryLines.push(`- 변경 파일:`);
      for (const f of changedFiles) {
        this.summaryLines.push(`  - \`${f}\``);
      }
    } else {
      this.summaryLines.push(`- 변경 파일: 없음`);
    }

    this.summaryLines.push("");
  }

  summary(total: number, completed: number): void {
    this.summaryLines.push(`---\n`);
    this.summaryLines.push(`## 최종 결과\n`);
    this.summaryLines.push(`- 전체 목표: ${total}개`);
    this.summaryLines.push(`- 완료: ${completed}개`);
    this.summaryLines.push(`- 미완료: ${total - completed}개`);
  }

  save(): string {
    const summaryPath = path.join(this.runDir, "summary.md");
    fs.writeFileSync(summaryPath, this.summaryLines.join("\n"), "utf-8");
    return summaryPath;
  }
}

// ── 체크리스트 변경 감지 ──────────────────────────────────────────────────────

/**
 * REVIEW_CHECKLIST.md의 "## 체크리스트 갱신 로그" 섹션에 누적된 entries를 최근 N개로
 * 자동 트림. Reviewer가 결과 보고를 무심코 추가했을 때의 안전망.
 * "## " 로 시작하는 헤더 라인은 보존하고, "- (YYYY-..." 패턴의 entry만 잘라낸다.
 */
export function trimChecklistLog(maxEntries: number = CHECKLIST_LOG_MAX_ENTRIES): void {
  if (!fs.existsSync(CHECKLIST_FILE)) return;
  const content = fs.readFileSync(CHECKLIST_FILE, "utf-8");
  const logHeaderIdx = content.indexOf("## 체크리스트 갱신 로그");
  if (logHeaderIdx < 0) return;

  const header = content.slice(0, logHeaderIdx);
  const logSection = content.slice(logHeaderIdx);
  const lines = logSection.split("\n");

  // entry 라인(- (YYYY-...) ...)을 추출, 헤더/설명 라인은 그대로 유지
  const entryRegex = /^- \(\d{4}-\d{2}-\d{2}\)/;
  const entryIndices: number[] = [];
  lines.forEach((l, i) => { if (entryRegex.test(l)) entryIndices.push(i); });
  if (entryIndices.length <= maxEntries) return;

  // 가장 오래된 (entryIndices.length - maxEntries)개 라인을 제거
  const toRemove = new Set(entryIndices.slice(0, entryIndices.length - maxEntries));
  const trimmedLines = lines.filter((_, i) => !toRemove.has(i));
  const removed = lines.length - trimmedLines.length;
  fs.writeFileSync(CHECKLIST_FILE, header + trimmedLines.join("\n"), "utf-8");
  console.log(`  🧹 REVIEW_CHECKLIST 갱신 로그 자동 트림: ${removed}개 entry 제거 (최근 ${maxEntries}개 유지)`);
}

export function readChecklistHash(): string {
  try {
    return fs.readFileSync(CHECKLIST_FILE, "utf-8");
  } catch {
    return "";
  }
}

export function formatMetrics(m: StageMetrics): string {
  const sec = (m.durationMs / 1000).toFixed(1);
  const cost = m.costUsd.toFixed(4);
  const inTok = m.inputTokens.toLocaleString();
  const outTok = m.outputTokens.toLocaleString();
  const cacheRead = m.cacheReadTokens > 0 ? `, cache_read=${m.cacheReadTokens.toLocaleString()}` : "";
  return `${sec}s, $${cost}, in=${inTok}, out=${outTok}${cacheRead}, turns=${m.numTurns}`;
}

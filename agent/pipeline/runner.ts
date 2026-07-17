/// <reference types="node" />
/**
 * Project BADA — 외부 실행기 래퍼 (Claude Code CLI + Ollama 로컬 API)
 *
 * - findClaude/CLAUDE_BIN: claude 바이너리 탐색 (setGoals·vision/judge도 재사용)
 * - runClaude: 일시 과부하(overload/5xx)에 지수 백오프 재시도하는 견고한 CLI 호출
 * - runOllama: localhost:11434 Ollama 단발 텍스트 생성
 */

import { execSync, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  ROOT,
  MAX_API_RETRIES,
  RETRY_BASE_MS,
  type StageMetrics,
  type StageResult,
  type ClaudeJsonResult,
  type ClaudeOptions,
} from "./types.js";

// ── Claude Code CLI 경로 ──────────────────────────────────────────────────────

export function findClaude(): string {
  try {
    return execSync("which claude", {
      encoding: "utf-8",
      shell: process.env.SHELL ?? "/bin/zsh",
      env: process.env,
    }).trim();
  } catch {
    throw new Error(
      "claude CLI를 찾을 수 없습니다. Claude Code가 설치되어 있는지 확인하세요."
    );
  }
}

export const CLAUDE_BIN = findClaude();

// ── 응답 파싱 ────────────────────────────────────────────────────────────────

export function parseClaudeJson(raw: string): { output: string; metrics?: StageMetrics; isError: boolean; budgetExhausted: boolean } {
  try {
    const parsed = JSON.parse(raw) as ClaudeJsonResult;
    const metrics: StageMetrics = {
      durationMs: parsed.duration_ms ?? 0,
      apiDurationMs: parsed.duration_api_ms ?? 0,
      costUsd: parsed.total_cost_usd ?? 0,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      numTurns: parsed.num_turns ?? 0,
    };
    // --max-budget-usd 도달 시 CLI가 subtype "error_max_budget_usd"로 종료.
    const budgetExhausted = parsed.subtype === "error_max_budget_usd";
    return { output: parsed.result ?? "", metrics, isError: parsed.is_error === true, budgetExhausted };
  } catch {
    return { output: raw, isError: false, budgetExhausted: false };
  }
}

// API 사용량 한도 도달 메시지 감지. CLI는 이를 일반 텍스트 응답으로 흘리기도 하므로
// ("You've hit your limit · resets …") HTTP 코드 외에 실제 메시지 문구도 포함한다.
export function isRateLimitMessage(text: string): boolean {
  return /rate.?limit|too many requests|429|usage.?limit|quota|hit your limit|reset(s)?\s+\d{1,2}:\d{2}\s?(am|pm)/i.test(text);
}

// 서버 일시 과부하(529/overloaded) 또는 일시적 서버 오류 — 재시도하면 대개 풀린다.
// 일 사용량 한도(isRateLimitMessage)와 달리 짧은 백오프로 회복 가능.
export function isOverloadMessage(text: string): boolean {
  // status code는 단어 경계로 감싸 비용/토큰 수치 오탐 방지. 성공 응답엔 적용 안 됨(success로 먼저 걸러짐).
  return /overloaded|\b(529|503|500)\b|service unavailable|temporarily|internal server error|timeout|ETIMEDOUT|ECONNRESET/i.test(text);
}

// 동기 파이프라인을 블로킹 대기 (CPU 점유 없이). Atomics.wait는 메인 스레드에서도 동작.
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runClaudeOnce(
  prompt: string,
  allowedTools: string,
  maxTurns: number,
  opts: ClaudeOptions = {},
): StageResult {
  try {
    const args = [
      "-p", prompt,
      "--allowedTools", allowedTools,
      "--max-turns", String(maxTurns),
      "--output-format", "json",
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.effort) {
      args.push("--effort", opts.effort);
    }
    if (opts.budgetUsd !== undefined) {
      args.push("--max-budget-usd", String(opts.budgetUsd));
    }
    const raw = execFileSync(
      CLAUDE_BIN,
      args,
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 600_000,
        env: process.env,
      }
    );
    const { output, metrics, isError, budgetExhausted } = parseClaudeJson(raw);
    // 정상 반환에도 한도 메시지가 본문에 실려 올 수 있음 (CLI가 non-error로 처리하는 경우).
    return { output, success: !isError && !isRateLimitMessage(output), rateLimited: isRateLimitMessage(output), budgetExhausted, metrics };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const rawOut = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    // JSON 응답이 stdout에 일부 있을 수 있음 — 우선 파싱 시도
    const { output, metrics, budgetExhausted } = parseClaudeJson(rawOut);
    const finalOutput = output || rawOut;
    const rateLimited = isRateLimitMessage(finalOutput);
    return { output: finalOutput, success: false, rateLimited, budgetExhausted, metrics };
  }
}

// 일시적 인프라 장애(overload/529, 5xx, 타임아웃)에 회복력을 더하는 재시도 래퍼.
// overload는 지수 백오프로 재시도하면 대개 풀린다. 일 사용량 한도(rate-limit)는
// 짧은 대기로 안 풀리므로 마지막 시도까지 실패하면 그대로 rate-limited를 반환한다
// (호출부의 기존 rate-limited 처리 흐름 유지). 성공/코드실패/한도도달은 즉시 반환.
export function runClaude(
  prompt: string,
  allowedTools: string,
  maxTurns: number,
  opts: ClaudeOptions = {},
): StageResult {
  let last: StageResult = { output: "", success: false, rateLimited: false };
  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    last = runClaudeOnce(prompt, allowedTools, maxTurns, opts);
    // 성공이거나, 일시 과부하가 아닌 실패(코드 실패·일 한도)면 재시도 무의미 → 즉시 반환.
    if (last.success || !isOverloadMessage(last.output)) return last;
    if (attempt < MAX_API_RETRIES) {
      const waitMs = RETRY_BASE_MS * 2 ** attempt; // 4s, 8s, 16s
      console.log(`  ⚠ 일시적 서버 과부하 감지 — ${waitMs / 1000}s 후 재시도 (${attempt + 1}/${MAX_API_RETRIES})`);
      sleepSync(waitMs);
    }
  }
  console.log(`  ✗ 재시도 ${MAX_API_RETRIES}회 모두 과부하로 실패`);
  return last;
}

// ── Ollama 로컬 API 호출 ──────────────────────────────────────────────────────
// localhost:11434의 Ollama 서버에 직접 HTTP 요청. Tool use 없이 단발 텍스트 생성.
// 실패 시 OllamaError를 throw해서 파이프라인 전체를 중단시킨다.

export class OllamaError extends Error {
  constructor(message: string, public model: string) {
    super(message);
    this.name = "OllamaError";
  }
}

export function runOllama(model: string, prompt: string): string {
  const tmpFile = path.join(ROOT, "agent", ".ollama-tmp.json");
  let curlOutput: string;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({ model, prompt, stream: false }), "utf-8");
    try {
      curlOutput = execFileSync(
        "curl",
        ["-sS", "--fail-with-body",
         "-X", "POST", "http://localhost:11434/api/generate",
         "-H", "Content-Type: application/json",
         "-d", `@${tmpFile}`],
        { encoding: "utf-8", timeout: 300_000 }
      );
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; signal?: string; code?: string };
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
        throw new OllamaError(`호출 타임아웃 (300초 초과)`, model);
      }
      const detail = (err.stderr || err.stdout || String(e)).toString().trim();
      throw new OllamaError(
        `curl 실패 (Ollama 서버 미동작 가능): ${detail.slice(0, 400)}`,
        model
      );
    }
    let data: { response?: string; error?: string };
    try {
      data = JSON.parse(curlOutput);
    } catch {
      throw new OllamaError(
        `응답 JSON 파싱 실패. 응답 본문 발췌: ${curlOutput.slice(0, 300)}`,
        model
      );
    }
    if (data.error) {
      throw new OllamaError(`Ollama 응답 에러: ${data.error}`, model);
    }
    const response = (data.response ?? "").trim();
    if (!response) {
      throw new OllamaError(`응답 본문이 비어있음`, model);
    }
    return response;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

export function assertGoalsFormat(output: string, model: string, context: string): void {
  if (!/GOALS_START[\s\S]*?GOALS_END/.test(output)) {
    throw new OllamaError(
      `${context}: 응답에 GOALS_START/END 마커가 없습니다. 모델이 출력 포맷을 따르지 않았습니다.\n응답 발췌:\n${output.slice(0, 800)}`,
      model
    );
  }
}

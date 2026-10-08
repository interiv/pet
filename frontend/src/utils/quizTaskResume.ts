/**
 * 「课堂做题」两条 AI 任务的未完成存档
 *
 * 一份是出题（创建课堂做题时的「AI 快速出题」），一份是控制台的 AI 判分。
 * 两者分开存：老师可能出着题的同时在另一场课堂里判分，互不该覆盖。
 *
 * 课堂判分比出题多存了「判的是谁、哪道题、答了什么」，
 * 因为恢复出来时这些上下文已经不在内存里了，得靠它把判分结果还原回去。
 *
 * 底层读写见 taskArchive.ts。
 */

import { readTaskArchive, writeTaskArchive, clearTaskArchive } from './taskArchive';
import type { GenMode } from './genTaskResume';

const GEN_NS = 'pendingQuizGenTask';
const JUDGE_NS = 'pendingQuizJudgeTask';

// ===== 出题 =====

export interface PendingQuizGenTask {
  taskId: string;
  mode: GenMode;
  /** 创建弹窗里 AI 出题那部分的表单值（ai_topic / ai_requirements / ai_batches 等） */
  formValues: Record<string, any>;
  /** 出题分组数，用于进度条上的 x/y */
  total: number;
  /** 后端是否已跑完；跑完但还没保存题目时仍要保留，好把题目取回来 */
  done?: boolean;
  createdAt: number;
}

export function readPendingQuizGen(userId?: number | string | null): PendingQuizGenTask | null {
  return readTaskArchive(GEN_NS, userId) as PendingQuizGenTask | null;
}

export function writePendingQuizGen(userId: number | string | undefined | null, task: PendingQuizGenTask) {
  writeTaskArchive(GEN_NS, userId, task as any);
}

export function clearPendingQuizGen(userId?: number | string | null) {
  clearTaskArchive(GEN_NS, userId);
}

// ===== AI 判分 =====

export interface PendingQuizJudgeTask {
  taskId: string;
  subject?: string;
  questionId?: number;
  questionText: string;
  /** 判分时学生作答的原文，恢复后要原样带回去，否则结果对不上题 */
  studentAnswer: string;
  /** 答题人 id；控制台里换场次后靠它把判分结果绑回同一个学生 */
  studentId?: number;
  studentName?: string;
  /** 判的是第几道题（0 起），仅用于恢复后提示老师 */
  questionIndex?: number;
  createdAt: number;
}

export function readPendingQuizJudge(userId?: number | string | null): PendingQuizJudgeTask | null {
  return readTaskArchive(JUDGE_NS, userId) as PendingQuizJudgeTask | null;
}

export function writePendingQuizJudge(userId: number | string | undefined | null, task: PendingQuizJudgeTask) {
  writeTaskArchive(JUDGE_NS, userId, task as any);
}

export function clearPendingQuizJudge(userId?: number | string | null) {
  clearTaskArchive(JUDGE_NS, userId);
}
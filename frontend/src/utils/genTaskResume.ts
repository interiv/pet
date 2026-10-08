/**
 * 「作业 - 发布新作业」AI 出题的未完成任务存档
 *
 * 底层读写见 taskArchive.ts，这里只做类型化的薄封装。
 * 生命周期：
 *   拿到 task_id → 写（done:false）
 *   轮询到结果   → 覆盖为 done:true（保留，后端任务在保留期内仍能取回结果）
 *   发布成功 / 关闭并撤销 / 恢复失败 → 清掉
 */

import { readTaskArchive, writeTaskArchive, clearTaskArchive } from './taskArchive';

const NS = 'pendingGenTask';

export type GenMode = 'topic' | 'requirements' | 'paste';

export interface PendingGenTask {
  taskId: string;
  /** 出题方式，决定恢复时该回填哪个输入框 */
  mode: GenMode;
  /** 提交时的表单内容，恢复后回填给老师看「当时是按什么要求在出题」 */
  formValues: Record<string, any>;
  /** 题型总数，用于进度条上的 x/y */
  total: number;
  /** 后端是否已经跑完。跑完但还没发布时仍要保留，用于把结果重新取回来接着发布 */
  done?: boolean;
  /** done 时对应的生成记录 id，撤销时用它对账 */
  usageId?: number;
  createdAt: number;
}

export function readPendingGenTask(userId?: number | string | null): PendingGenTask | null {
  return readTaskArchive(NS, userId) as PendingGenTask | null;
}

export function writePendingGenTask(userId: number | string | undefined | null, task: PendingGenTask) {
  writeTaskArchive(NS, userId, task as any);
}

export function clearPendingGenTask(userId?: number | string | null) {
  clearTaskArchive(NS, userId);
}
/**
 * AI 长耗时任务的轮询客户端
 *
 * 后端把「出题/ 纸质识别 / 学情报告 / AI 教练」都改成了
 * 「提交任务 + 后台执行」，前端用这里的统一轮询拿进度。
 *
 * 为什么不用长连接：这些操作要调大模型，单次可能跑几分钟，
 * 而 Nginx proxy_read_timeout 默认 60s，长连接会被网关切断（504）。
 * 改成轮询后每个请求都在 1 秒内结束，网关永远不介入。
 */

import api from './api';

export interface AiTaskProgress {
  percent: number;
  done: number;
  total: number;
  current: string;
}

export interface AiTaskResult {
  task_id: string;
  kind?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  done: number;
  total: number;
  current_label?: string;
  percent: number;
  result?: any;
  error?: string;
}

const POLL_INTERVAL = 2000;
/** 兜底上限：单批AI 调用最长 300s，多步任务留足余量 */
const MAX_WAIT_MS = 12 * 60 * 1000;

/**
 * 各功能的「进度查询」路径模板，集中在这里而不是散落在各组件里。
 *
 * 起因：课堂做题原来在组件里手写成 '/classroom-quiz/task/:taskId'，
 * 而后端这条路由挂在 /api/cards 下（server.js: app.use('/api/cards', cardRoutes)），
 * 于是每次轮询都 404，被当成「任务已失效」抛给老师——
 * 其实后端任务好好地在跑，额度也照扣，再点一次还会撞上 409 互斥。
 * 手写路径就是这么容易漂移，收敛到一处后改路由只需改这里。
 */
export const AI_TASK_URLS = {
  /** 作业出题：backend/src/routes/assignments.js */
  assignmentGenerate: '/assignments/generate/:taskId',
  /** 课堂做题出题与 AI 判分共用：backend/src/routes/cards.js */
  classroomQuizTask: '/cards/classroom-quiz/task/:taskId',
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询直到任务完成，返回最终结果。
 *
 * @param taskId  后端返回的任务号
 * @param url模板  各功能的进度接口不同，形如 '/assignments/generate/:taskId'
 * @param onProgress 每轮回调，用于刷新进度条
 */
export async function pollAiTask(
  taskId: string,
  urlTemplate: string,
  onProgress?: (p: AiTaskProgress) => void
): Promise<any> {
  const url = urlTemplate.replace(':taskId', encodeURIComponent(taskId));
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error('处理耗时过长，已停止等待。请稍后重试');
    }

    let data: AiTaskResult;
    try {
      const r = await api.get(url, { timeout: 15000 });
      data = r.data;
    } catch (e: any) {
      if (e?.response?.status === 404) {
        throw new Error('任务已失效（服务可能刚重启过），请重新发起');
      }
      // 网络抖动：下一轮继续，不打断整个流程
      await sleep(POLL_INTERVAL);
      continue;
    }

    onProgress?.({
      percent: data.percent ?? 0,
      done: data.done ?? 0,
      total: data.total ?? 0,
      current: data.current_label || '处理中',
    });

    if (data.status === 'done') {
      if (data.result === null || data.result === undefined) {
        throw new Error('处理完成但未返回结果，请重试');
      }
      return data.result;
    }
    if (data.status === 'failed') {
      throw new Error(data.error || '处理失败');
    }
    await sleep(POLL_INTERVAL);
  }
}

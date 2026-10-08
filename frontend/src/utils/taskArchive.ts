/**
 * AI 异步任务的本地存档底座
 *
 * 解决的问题：出题/判分这类任务动辄跑几分钟，老师看到进度条走到一半
 * 会顺手叉掉弹窗、切去别的菜单、甚至刷新页面。而 task_id 只活在前端的一个
 * 局部变量里，回来时只能重新提交一次——白等几分钟，还多扣一次生成额度
 * （后端还会因同类任务互斥返回 409）。后端任务其实一直好好地跑着。
 *
 * 所以拿到 task_id 就往 localStorage 存一份，回来时重新挂上同一个任务的轮询。
 * 三个业务模块（作业出题 / 课堂出题 / 课堂判分）共用这里，
 * 各自再包一层带类型的读写函数，见 genTaskResume.ts 与 quizTaskResume.ts。
 */

/**
 * 存档有效期：超过就当任务已失效，读时顺手清掉。
 * 必须与后端 genTaskManager.js 的 TASK_TTL_MS 一致，
 * 否则会出现「本地还留着、但后端已经扫掉」或「后端还在、本地先扔了」。
 */
export const AI_TASK_TTL_MS = 30 * 60 * 1000;

export interface TaskArchive {
  taskId: string;
  createdAt: number;
  [key: string]: any;
}

const keyOf = (namespace: string, userId: number | string) => `petlaicun:${namespace}:${userId}`;

/**
 * 读一份存档；没有、过期或数据损坏都返回 null（顺带清掉脏数据）。
 * 读不到不是错误——只是说明这次要按全新流程走，调用方正常处理即可。
 */
export function readTaskArchive(namespace: string, userId?: number | string | null): TaskArchive | null {
  if (userId === undefined || userId === null) return null;
  try {
    const raw = localStorage.getItem(keyOf(namespace, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TaskArchive;
    if (!parsed || !parsed.taskId) {
      localStorage.removeItem(keyOf(namespace, userId));
      return null;
    }
    if (Date.now() - Number(parsed.createdAt || 0) > AI_TASK_TTL_MS) {
      localStorage.removeItem(keyOf(namespace, userId));
      return null;
    }
    return parsed;
  } catch {
    // localStorage 被禁用（隐私模式）或数据损坏：当作没有存档
    return null;
  }
}

export function writeTaskArchive(namespace: string, userId: number | string | undefined | null, data: TaskArchive) {
  if (userId === undefined || userId === null) return;
  try {
    localStorage.setItem(keyOf(namespace, userId), JSON.stringify(data));
  } catch {
    // 写不进去不影响任务本身，只是关掉弹窗后接不回来
  }
}

export function clearTaskArchive(namespace: string, userId?: number | string | null) {
  if (userId === undefined || userId === null) return;
  try {
    localStorage.removeItem(keyOf(namespace, userId));
  } catch {
    /* ignore */
  }
}
/**
 * AI 生成任务管理器
 *
 * 用途：让「耗时几分钟的出题」不再依赖一条长时间挂着的 HTTP 连接。
 * 提交后立即拿到 task_id，前端每 2 秒轮询一次进度，每次请求都在 1 秒内结束，
 * 因此不会触发 Nginx proxy_read_timeout（默认 60s）导致的 504。
 *
 * 为什么存内存而不是建表：
 *   任务本身是「一次点击」的临时状态，进程重启后用户重新点一次即可，
 *   没必要为它建表；真正的产物（题目）仍然照常写进 question_bank。
 *   代价是容器重启会丢失进行中的任务——但那种情况下用户本来就拿不到结果，
 *   前端会提示任务丢失让他重来，不会静默失败。
 */

const crypto = require('crypto');

/** 任务保留时长：超时后自动清理，避免内存无限增长 */
const TASK_TTL_MS = 30 * 60 * 1000;
/** 兜底清理间隔 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** @type {Map<string, object>} taskId -> task */
const tasks = new Map();

/**
 * @typedef {object} GenTask
 * @property {string} id
 * @property {number} userId
 * @property {'pending'|'running'|'done'|'failed'} status
 * @property {{topic:string, subject:string}} meta
 * @property {number} done            已完成的题型数
 * @property {number} total           题型总数
 * @property {string} currentLabel    当前正在生成的题型标签
 * @property {string} phase           当前阶段：precheck | spec_start | spec_done | saving
 * @property {?{status:number, body:object}} result
 * @property {?string} error
 * @property {number} createdAt
 * @property {number} updatedAt
 */

class GenTask {
  constructor({ userId, topic, subject }) {
    this.id = crypto.randomUUID();
    this.userId = userId;
    this.status = 'pending';
    this.meta = { topic, subject };
    this.done = 0;
    this.total = 0;
    this.currentLabel = '';
    this.phase = 'precheck';
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
  }

  updateProgress(p = {}) {
    if (typeof p.total === 'number' && p.total > 0) this.total = p.total;
    if (typeof p.done === 'number') this.done = p.done;
    if (p.label) this.currentLabel = p.label;
    if (p.phase) this.phase = p.phase;
    this.updatedAt = Date.now();
  }

  toPublicJSON() {
    const base = {
      task_id: this.id,
      status: this.status,
      topic: this.meta.topic,
      subject: this.meta.subject,
      done: this.done,
      total: this.total,
      current_label: this.currentLabel,
      // 由 done/total 推一个粗略百分比，只用于画进度条，不需要精确
      percent: this.total > 0 ? Math.min(99, Math.round((this.done / this.total) * 100)) : 5,
    };
    if (this.status === 'done') return { ...base, percent: 100, result: this.result?.body ?? null };
    if (this.status === 'failed') return { ...base, error: this.error || '生成失败' };
    return base;
  }
}

const genTaskManager = {
  create(payload) {
    const task = new GenTask(payload);
    tasks.set(task.id, task);
    return task;
  },

  get(id) {
    return tasks.get(id) || null;
  },

  markRunning(id) {
    const t = tasks.get(id);
    if (t) {
      t.status = 'running';
      t.updatedAt = Date.now();
    }
  },

  updateProgress(id, progress) {
    const t = tasks.get(id);
    if (t) t.updateProgress(progress);
  },

  complete(id, result) {
    const t = tasks.get(id);
    if (!t) return;
    t.status = 'done';
    t.result = result;
    t.done = t.total || 1;
    t.currentLabel = '';
    t.phase = 'done';
    t.updatedAt = Date.now();
  },

  fail(id, error) {
    const t = tasks.get(id);
    if (!t) return;
    t.status = 'failed';
    t.error = error;
    t.currentLabel = '';
    t.updatedAt = Date.now();
  },

  /** 找出某用户正在进行的任务（含尚未开始的），用于拦截重复点击 */
  findRunning(userId) {
    for (const t of tasks.values()) {
      if (t.userId === userId && (t.status === 'pending' || t.status === 'running')) return t;
    }
    return null;
  },

  /** 清理过期任务 */
  sweep() {
    const now = Date.now();
    for (const [id, t] of tasks) {
      if (now - t.updatedAt > TASK_TTL_MS) tasks.delete(id);
    }
  },

  /** 仅供测试：清空所有任务 */
  _clear() {
    tasks.clear();
  },
};

// 用 unref 避免这个定时器本身阻止进程退出（测试脚本里有用）
const timer = setInterval(() => genTaskManager.sweep(), CLEANUP_INTERVAL_MS);
if (typeof timer.unref === 'function') timer.unref();

module.exports = { genTaskManager, GenTask, TASK_TTL_MS };

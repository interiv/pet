/**
 * AI 长耗时任务的「提交 + 后台执行 + 轮询」通用支持
 *
 * 背景：出题、扫描纸质作业、学情报告、AI 教练都要调大模型，单次可能跑几分钟。
 * 若用一条长连接挂着，Nginx proxy_read_timeout（默认 60s）会切断，浏览器看到 504。
 * 统一改成：POST 立即返回 task_id，后台跑，前端每 2 秒查进度。
 *
 * 好处：
 *   - 每个 HTTP 请求都 <1s，网关永远不会介入
 *   - 前端能显示真实进度，而不是一个转圈
 *   - 同一用户重复点击会被拦下，不再白烧AI 额度
 */
const { genTaskManager } = require('../services/genTaskManager');

/**
 * 伪响应对象：让原本「直接 res.json()」的业务函数能在后台跑。
 * 它长得像 Express 的 res，但只把结果记到 out 里，不发给任何客户端。
 * 这样业务函数一行不用改就能异步化。
 */
function createCapturedResponder() {
  const out = { status: 200, body: null, sent: false };
  const r = {
    out,
    status(code) { out.status = code; return r; },
    json(payload) { out.sent = true; out.body = payload; return r; },
    send(payload) { out.sent = true; out.body = payload; return r; },
    sendStatus(code) { out.status = code; out.sent = true; return r; },
    set() { return r; },
    header() { return r; },
    type() { return r; },
  };
  return r;
}

/**
 * 提交一个后台任务并立即返回 202。
 *
 * @param {object} opts
 * @param {import('express').Response} opts.res
 * @param {number} opts.userId
 * @param {string} opts.kind        任务类型，用于同类互斥与前端解析
 * @param {string} opts.title       任务描述（进度条上显示）
 * @param {string} [opts.subject]
 * @param {number} [opts.total]     分步骤任务的总步数
 * @param {string} [opts.runningMsg] 进行中提示
 * @param {() => Promise<void>} opts.runner后台逻辑，内部把结果写进 res
 * @returns {import('express').Response}
 */
function startAsyncTask(res, { userId, kind, title, subject, total, runningMsg }, runner) {
  // 同类型任务互斥：防止同一个老师重复点击，白烧一次 AI 额度
  const running = genTaskManager.findRunning(userId, kind);
  if (running) {
    return res.status(409).json({
      error: '已有一个相同的任务正在进行，请等待它完成',
      task_id: running.id,
    });
  }

  const task = genTaskManager.create({ userId, kind, topic: title, subject, total });

  res.status(202).json({
    task_id: task.id,
    message: runningMsg || '已开始处理，请稍候',
  });

  // 后台执行。不阻塞响应，也就不受任何网关超时约束。
  setImmediate(async () => {
    const fakeRes = createCapturedResponder();
    try {
      genTaskManager.markRunning(task.id);
      await runner(fakeRes, (progress) => genTaskManager.updateProgress(task.id, progress));
      if (!fakeRes.out.sent) {
        genTaskManager.fail(task.id, '处理流程异常结束，请重试');
        return;
      }
      // 业务函数是用 res.status(4xx/5xx).json({error}) 表达失败的。
      // 若不区分，任务会被标成 done，前端把 {status:502, body:{error}} 当成正常结果，
      // 结果就是「生成成功但页面空白」。这里统一转成 failed。
      const httpStatus = fakeRes.out.status;
      if (httpStatus >= 400) {
        const msg = (fakeRes.out.body && (fakeRes.out.body.error || fakeRes.out.body.message))
          || `处理失败（HTTP ${httpStatus}）`;
        genTaskManager.fail(task.id, msg);
        return;
      }
      genTaskManager.complete(task.id, { status: httpStatus, body: fakeRes.out.body });
    } catch (err) {
      console.error(`[${kind}] 后台任务异常:`, err);
      genTaskManager.fail(task.id, err.message || '处理失败');
    }
  });

  return res;
}

/**
 * 任务查询路由的标准处理：鉴权 + 归属校验。
 * @returns {boolean} true 表示请求已被响应（找不到或无权限时）
 */
function handleTaskQuery(req, res) {
  const task = genTaskManager.get(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: '任务不存在或已过期，请重新发起' });
    return true;
  }
  // 只能查自己的任务，防止横向读取别人的生成结果
  if (task.userId !== req.user.userId && req.user.role !== 'admin') {
    res.status(403).json({ error: '无权查看该任务' });
    return true;
  }
  res.json(task.toPublicJSON());
  return true;
}

module.exports = { createCapturedResponder, startAsyncTask, handleTaskQuery };

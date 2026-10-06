import { fork } from 'node:child_process';
import crypto from 'node:crypto';

// Keep inference out of Vite's event loop and release its memory when idle.
export function createPhotoDepthGenerator(root, { idleMs = 30000, timeoutMs = 180000 } = {}) {
  let child, idle, chain = Promise.resolve(), closed = false;
  const pending = new Map();
  function stop() {
    clearTimeout(idle);
    const process = child; child = undefined;
    process?.kill();
  }
  function start() {
    if (child) return child;
    const process = fork(new URL('./photo-depth-worker.mjs', import.meta.url), [root], { execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child = process;
    process.on('message', message => {
      const job = pending.get(message?.id);
      if (!job || job.process !== process) return;
      pending.delete(message.id); clearTimeout(job.timer);
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(Buffer.from(message.bytes));
    });
    const failed = error => {
      if (child === process) child = undefined;
      for (const [id, job] of pending) if (job.process === process) {
        pending.delete(id); clearTimeout(job.timer);
        job.reject(new Error(error?.message || '深度生成进程已结束，请重试。'));
      }
    };
    process.on('error', failed);
    process.on('exit', () => failed());
    return process;
  }
  function generate(source) {
    const result = chain.then(async () => {
      if (closed) throw new Error('深度生成服务已关闭，请重新打开编辑器。');
      clearTimeout(idle);
      const process = start(), id = crypto.randomUUID();
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id); stop(); reject(new Error('深度生成耗时过长，照片已保留，请重试。'));
          }, timeoutMs);
          pending.set(id, { process, timer, resolve, reject });
          process.send({ id, source }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(error); } });
        });
      } finally {
        idle = setTimeout(stop, idleMs); idle.unref();
      }
    });
    chain = result.catch(() => {});
    return result;
  }
  return { generate, close() { closed = true; stop(); } };
}

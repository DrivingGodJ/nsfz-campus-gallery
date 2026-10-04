/** Parse platform-generated HTML failures as well as our own JSON errors. */
export async function readServiceResponse(response) {
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch {}
  if (!response.ok) {
    let message = typeof data?.error === 'string' ? data.error : '';
    if (/\b1027\b/.test(raw) || data?.code === 'WORKER_DAILY_LIMIT') message = '服务今天的请求额度已用完，请在北京时间下一个 08:00 后重试。当前内容已保留。';
    else if (/\b1102\b/.test(raw)) message = '服务本次处理超时，请稍后重试。当前内容已保留。';
    else if (/TooManyRequests|QuotaExceeded|StorageLimitExceeded|SlowDown/i.test(raw)) message = '存储服务达到请求限额或过于繁忙，请稍后重试。当前内容已保留。';
    else if (!message && response.status === 429) message = '服务达到请求限额，请稍后重试。当前内容已保留。';
    else if (!message && response.status === 413) message = '照片或请求内容过大，请缩小后重试。';
    else if (!message) message = '服务暂时不可用，请稍后重试。当前内容已保留。';
    const error = new Error(message); error.code = data?.code || (response.status === 429 ? 'RATE_LIMIT' : 'SERVICE_UNAVAILABLE'); throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('未收到完整的服务回复，请重试。');
  return data;
}

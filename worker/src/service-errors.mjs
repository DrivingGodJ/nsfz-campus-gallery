/** @param {unknown} error */
export function serviceFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/D1.*(?:quota|limit|exceeded)|(?:read|write|storage).*limit.*(?:exceeded|reached)|database.*(?:full|size limit)/i.test(message))
    return { code: 'DATABASE_LIMIT', error: '投稿服务的数据库额度已用完，请稍后再试或联系管理员。当前标注已保留。' };
  return { code: 'SERVICE_UNAVAILABLE', error: '投稿服务暂时不可用，请稍后重试。当前标注已保留。' };
}

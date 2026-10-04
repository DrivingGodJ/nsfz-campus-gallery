import fs from 'node:fs/promises';

const config = JSON.parse(await fs.readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8'));
const database = config.d1_databases?.find(value => value.binding === 'DB');
const origins = (config.vars?.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const validOrigin = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; } };
if (!/^[a-f0-9]{32}$/.test(config.account_id || '')) throw new Error('请先在 worker/wrangler.jsonc 设置目标 Cloudflare account_id。');
if (!database?.database_id || database.database_id === '00000000-0000-0000-0000-000000000000') throw new Error('请先填写已创建的 D1 database_id；本地测试数据库不会自动发布。');
if (!origins.length || !origins.every(validOrigin)) throw new Error('请填写 ALLOWED_ORIGINS：网站的 HTTPS 来源，不带路径或末尾斜杠。');
console.log('已核对点赞服务的目标账户、数据库与网站来源。');

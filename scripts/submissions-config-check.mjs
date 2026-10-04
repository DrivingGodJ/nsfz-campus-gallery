import fs from 'node:fs/promises';
const config=JSON.parse(await fs.readFile(new URL('../worker/wrangler.jsonc',import.meta.url),'utf8'));
const vars=config.vars || {};
if(!/^[a-f0-9]{32}$/.test(vars.R2_ACCOUNT_ID || '') || vars.R2_ACCOUNT_ID!==config.account_id)throw new Error('请配置与目标账户相同的 R2_ACCOUNT_ID。');
if(!vars.TURNSTILE_HOSTNAMES || vars.TURNSTILE_HOSTNAMES.split(',').some(s=>!s.trim() || /localhost|127\.0\.0\.1|[/:]/.test(s)))throw new Error('请配置生产网站的 Turnstile 主机名，不含本地地址或路径。');
if(!config.r2_buckets?.some(b=>b.binding==='UPLOADS' && b.bucket_name===vars.R2_BUCKET_NAME))throw new Error('R2 投稿存储绑定与签名桶名不一致。');
for(const key of ['MAX_STORAGE_BYTES','MAX_DAILY_SUBMISSIONS','MAX_DAILY_UPLOAD_BYTES'])if(!Number.isSafeInteger(Number(vars[key])) || Number(vars[key])<=0)throw new Error('请配置正整数投稿限额：'+key);
console.log('投稿目标和限额配置检查通过；部署前还需设置私密服务密钥和 R2 CORS。');

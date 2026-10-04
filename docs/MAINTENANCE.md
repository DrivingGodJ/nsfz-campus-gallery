# 开发与维护

观众介绍见[项目首页](../README.md)。本文记录本地编辑、照片包审核和发布流程。

## 本地运行

需要 Node.js 22.12 或更高版本。

```sh
npm install
npm run dev
```

- 浏览页：<http://127.0.0.1:5178/>
- 本地编辑器：<http://127.0.0.1:5178/editor.html>
- 投稿页：<http://127.0.0.1:5178/submit.html>

编辑接口只服务于本地。公开构建不包含编辑器、草稿、私有原片和服务端凭证。

## 照片包审核与直接导入

1. 从邮件下载投稿 ZIP；投稿收件人为 `drivinggodj@icloud.com`。
2. 本地编辑器进入“照片”，点击“导入照片或投稿包”，或拖入 ZIP。支持批量导入；导入后进入本地草稿，不会直接公开。
3. 核对标题、地点、楼层、拍摄时间、镜头方向及署名；使用“照片与模型同屏”和“体验拍摄视角”检查，预览画面可拖动调角度。
4. 接收时点击“保存到内容库”。不接收时不保存，通过邮件回复投稿人。
5. 保存后推送 GitHub，等待 Pages 工作流完成。维护者自己的照片可以直接导入原片并保存，无需生成投稿包或发送邮件。

照片包保留原片，附带标注及校验信息。本地导入验证 ZIP 结构、体积、SHA-256 和标注范围，拒绝压缩炸弹、路径跳转及不合规数据。投稿包不能指定公开资产路径或照片编号。原片上传上限 40 MiB、7000 万像素；不支持的 HEIC／RAW 请先导出 JPEG。

航拍自动读取经纬度与相对起飞点或海拔高度，在校园范围内定位；信息不足时手动补齐。普通照片只记录地点和楼层。地点范围包含主要建筑、场地、湖泊、树林、各类走廊与地下空间；不含小地标。

作者读取 EXIF Artist、IPTC Byline、XMP dc:creator；版权读取 EXIF Copyright、IPTC CopyrightNotice、XMP dc:rights。不用相机拥有者字段推断作者，不添加默认许可。`npm run photos:credits` 从私有原片补全未设置字段，不覆盖手动填写或明确清空的署名，并自动备份。

## 图片与备份

| 文件 | 用途 | 规格 |
| --- | --- | --- |
| `thumbnail.webp` | 地图、目录与合并菜单 | 最长边 420 px |
| `preview.webp` | 普通浏览、照片与模型同屏、照片视角 | 最长边 1280 px，WebP 质量 65 起 |
| `display.webp` | 兼容旧展示图 | 最长边 2400 px，WebP 质量 88 起 |
| `download.jpg` | 全屏与高清下载 | 全尺寸，JPEG 质量 95 |
| `.local/originals/` | 私有原文件 | 按原字节保存，不发布 |

预览图和旧展示图严格小于 **1,500,000 字节**。超过上限时先降低质量，必要时缩小边长。高清 JPEG 不套用此限制；它经过旋转纠正、sRGB 转换及 EXIF 移除，不称作原文件。

浏览先显示已加载的缩略图，再异步解码并替换清晰预览。全屏先显示预览，高清准备好再替换。慢网或加载失败时，已有照片仍可见，旁边保留状态提示。高清只在全屏或下载时请求。

```sh
npm run photos:previews             # 为缺失预览的内容补生成
npm run photos:previews -- --refresh # 按当前规格重建已有预览
npm run photos:limits               # 只调整超过 1.5 MB 的预览／旧展示图
```

这些操作不改高清下载、原片或标注，覆盖前保存旧图到 `.local/backups/`。移出内容库的照片保留文件，可在编辑器恢复；移除记录位于 `.local/removed/`。标注写入有版本冲突检查与历史备份。

## 校园模型与数据

- `data/osm-source.json`：OSM 原始快照。
- `data/campus-corrections.json`：校园轮廓、分区楼层与设施校准。
- `public/data/campus.json`：当前公开校园地图。
- `public/data/site.json`：已保存照片与建筑资料。
- `src/`：浏览、投稿、本地编辑和三维模型。

`npm run map:refresh` 刷新 OSM 数据并重新应用校准。建筑按楼层数 × 层高计算高度，分区可单独设置楼层。模型用于照片定位展示，建筑高度和部分设施为示意。

## 检查与 GitHub Pages 发布

```sh
npm test
npm run likes:check
npm run build
npm run preview
```

本地默认构建使用相对路径，静态预览为 <http://127.0.0.1:4178/>。推送 `main` 后，GitHub Actions 自动检查、构建并发布 Pages。仓库 Settings → Pages → Source 应为 GitHub Actions。

工作流以 `PAGES_BASE_PATH=/<仓库名>/` 构建。使用根域名部署时改为 `/`。生产环境变量参考 [示例](../.env.production.example)；私有本地配置放在忽略的 `.env.production.local`。

静态导出仅包含已保存且仍被引用的照片；校验路径，在图片总量超过 900 MB 时中止，为其他网站资源留空间。提交成功不代表发布完成，应等待工作流结束，再检查线上网页与图片。

## 共享点赞

主站托管于 GitHub Pages，点赞由 Cloudflare Worker 和 D1 独立提供，接口为 `https://likes.drivinggodj.dpdns.org/api/likes`。浏览器保存随机标识，一张照片只能留一个赞，可取消；换浏览器、无痕模式或清除存储会产生新标识，不是严格人数统计，不读取 MAC 地址。

目录默认按点赞最多排序。同赞数按上传顺序；点赞未读取到时显示提示，暂按上传顺序，加载成功后恢复按赞数排序。上传时间与拍摄时间独立；缺少拍摄时间的照片排在最后。

Worker 配置位于 `worker/wrangler.jsonc`，绑定独立点赞域名；不更改其他服务域名。仓库 Actions Variables 中 `LIKES_API_URL` 指向公开接口，此地址不是密钥。Cloudflare token 不进入前端。

首次接入新的账户时：明确指定 `account_id` 和 D1 数据库 ID，设置 `ALLOWED_ORIGINS` 为网站来源（不含仓库路径，不使用通配符），执行 `npm run likes:migrate` 后检查及部署。已有数据库不需要重建。

```sh
npm run likes:manifest    # 更新已发布照片名单，不部署
npm run likes:check       # 类型与打包检查，不部署
npm run likes:deploy:only # 只部署点赞，不启用旧 R2 投稿服务
```

增删已发布照片后同步名单并部署点赞 Worker，保留已有数据库记录。来源限制、参数化 SQL、唯一约束、事务、浏览器限频与受限查询批量共同保护接口，不能完全防止不断更换标识刷赞。网络或额度异常显示错误并可重试；联网恢复或回到页面时重新读取。国内不同网络的可达性需要实际验证。

公开投稿现在使用浏览器本地 ZIP + 邮件，不依赖 R2、Turnstile 或旧在线投稿队列。仓库保留的旧队列实现不是当前公开投稿入口。

## 版权

地图数据 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，遵循 ODbL，校准后的地图数据同样适用。照片及代码是独立内容，不因地图许可而自动采用 ODbL；项目不额外授予照片转载许可。

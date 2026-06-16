# 识花定位 PWA

一个本地优先的识花定位 Progressive Web App。它可以拍照或选择图片、获取当前位置、生成识别候选、保存观察笔记，并通过 Service Worker 支持离线访问。部署到 Render 后，会通过同源 API 把观察记录保存到后端 SQLite。

## 当前功能

- 手机相机拍照或相册导入
- 浏览器 Geolocation 定位
- 地图视图展示带经纬度的观察点，支持点选查看详情并打开外部地图
- 记录详情支持编辑花名、笔记，并删除单条观察
- 花卉识别通过后端调用 PlantNet API，API key 不暴露给前端
- 观察笔记与记录优先保存到后端 SQLite，离线或 API 不可用时回落到 `localStorage`
- 上传前会在浏览器内压缩照片，降低移动端拍照后保存失败的概率
- PWA manifest、安装入口、离线缓存
- 响应式移动端布局
- Render 部署配置

## 本地运行

```bash
python3 server.py
```

然后打开 <http://127.0.0.1:8000/>。

## API

- `GET /api/health`：健康检查
- `POST /api/identify`：识别照片中的植物
- `GET /api/observations`：读取观察记录
- `POST /api/observations`：保存观察记录
- `PUT /api/observations/{id}`：更新单条观察记录
- `DELETE /api/observations/{id}`：删除单条观察记录
- `DELETE /api/observations`：清空观察记录

## Render 部署

项目包含 `render.yaml`，可以在 Render 里用 Blueprint 部署，也可以手动创建 Web Service：

- Runtime: Python
- Build Command: 留空
- Start Command: `python3 server.py`
- Environment Variable: `DATA_DIR=/opt/render/project/src/data`
- Environment Variable: `PLANTNET_API_KEY=你的 PlantNet API key`
- Optional Environment Variable: `PLANTNET_PROJECT=all`

注意：Render 上的浏览器定位需要 HTTPS，Render 默认域名满足这个要求。Render 默认文件系统是临时的，普通刷新不应该丢记录，但重新部署、服务重启或实例重建可能丢 SQLite 文件。要长期保存，请把服务升级到 paid web service 后添加 Persistent Disk，并设置 `DATA_DIR=/var/data`；如果要跨实例扩展，建议改接 PostgreSQL。

## PlantNet 识别

前端会把压缩后的照片发送到后端 `/api/identify`，后端再调用 PlantNet。返回结构会被整理为：

```js
{
  name: "月季",
  latin: "Rosa chinensis",
  confidence: 0.86,
  traits: ["花瓣层叠", "枝条可能有刺"]
}
```

可选替代方向：

- 百度 AI / 腾讯云识图：适合国内访问和账号体系
- 自建 TensorFlow.js / ONNX Runtime Web：适合隐私优先和离线推理

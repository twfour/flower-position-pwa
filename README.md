# 识花定位 PWA

一个本地优先的识花定位 Progressive Web App。它可以拍照或选择图片、获取当前位置、生成识别候选、保存观察笔记，并通过 Service Worker 支持离线访问。

## 当前功能

- 手机相机拍照或相册导入
- 浏览器 Geolocation 定位
- 花卉识别结果展示，当前为前端模拟候选，后续可替换为真实模型接口
- 观察笔记与记录保存在 `localStorage`
- PWA manifest、安装入口、离线缓存
- 响应式移动端布局

## 本地运行

```bash
python3 -m http.server 8000
```

然后打开 <http://127.0.0.1:8000/>。

## 后续接入真实识别

在 `app.js` 中把 `identifyButton` 的点击逻辑替换为真实 API 调用即可。建议返回结构保持为：

```js
{
  name: "月季",
  latin: "Rosa chinensis",
  confidence: 0.86,
  traits: ["花瓣层叠", "枝条可能有刺"]
}
```

可选服务方向：

- PlantNet / iNaturalist：适合自然观察社区数据
- 百度 AI / 腾讯云识图：适合国内访问和账号体系
- 自建 TensorFlow.js / ONNX Runtime Web：适合隐私优先和离线推理

# PPD本地化测试工具 Web版

这是根据 `PPD本地化测试工具需求合集.md` 实现的静态网页版 V1.0。

## 使用方式

推荐启动本地服务运行，这样可以通过接口读取 CUPS 打印机、实际图标和 `/etc/cups/ppd` 中的 PPD：

```bash
python3 /Users/Apple/Documents/opencode/poppler-26.02.0/ppd-localization-web/server.py
```

然后打开：

```text
http://127.0.0.1:4173/
```

也可以直接用浏览器打开静态页面，但静态模式无法访问 CUPS：

```text
/Users/Apple/Documents/opencode/poppler-26.02.0/ppd-localization-web/index.html
```

目录中包含 `sample.ppd` 和 `sample-standard.json`，页面里也有“加载样例”按钮，可以先用它们跑一遍完整流程。

## 已实现能力

- 打印机列表、搜索、选中详情
- 从 CUPS / `/etc/cups/ppd` 获取实际打印机队列、PPD 和 PPD 中声明的打印机图标
- 语言/区域选择
- PPD 文件导入与拖拽导入
- JSON / CSV 标准内容库导入
- PPD 可见本地化字段提取
- 标准内容比对
- 缺失、截断、乱码、格式异常、错误翻译、多余内容识别
- RapidOCR 视觉截断验证：上传控件截图和期望字符串，按 OCR 文本、置信度、右边界贴边、省略号判断 UI 是否截断；PaddleOCR 可作为备用引擎
- Linux 自动截图比对：输入控件 ROI 坐标后，服务端自动截图、裁剪、OCR 并判断是否截断
- 摘要统计、筛选、搜索、排序、详情弹窗
- Markdown / HTML 报告导出
- 配置项本地保存

## RapidOCR 截断验证

该能力优先使用轻量级 RapidOCR。需要在启动 `server.py` 的 Python 环境中安装：

```bash
pip install rapidocr onnxruntime
```

使用方式：

1. 截取或裁剪待验证的 UI 控件区域，建议只保留单个控件，图片右边界即控件右边界。
2. 在“PaddleOCR视觉截断验证”中输入标准库里的完整字符串。
3. 选择 OCR 语言并上传截图。
4. 点击“OCR截断判断”。

判断规则会综合：

- OCR 识别文本是否为期望字符串前缀
- 识别框是否贴近图片右边界
- 是否出现 `...` 或 `…`
- OCR 平均置信度
- OCR 文本与期望文本相似度

## Linux 自动截图比对

Linux 自动截图比对需要部署在 Linux 桌面会话中，并安装至少一个截图工具：

```bash
sudo apt install gnome-screenshot
```

或使用：

```bash
sudo apt install scrot xdotool
```

Wayland 环境可使用：

```bash
sudo apt install grim
```

接口：

```text
GET  /api/capture/linux/status
POST /api/capture/linux/ocr
```

`POST /api/capture/linux/ocr` 示例：

```json
{
  "expected_text": "双面打印",
  "language": "zh_CN",
  "window_title": "Print",
  "roi": { "x": 100, "y": 180, "width": 240, "height": 48 }
}
```

第一版使用坐标 ROI，后续可继续接入 AT-SPI/dogtail 根据控件可访问性信息自动定位控件。

## 标准库示例

JSON：

```json
{
  "printer_model": "LJ-MFP-001",
  "language": "zh_CN",
  "items": [
    { "key": "PageSize.A4", "standard_text": "A4" },
    { "key": "Duplex.DuplexNoTumble", "standard_text": "双面打印" }
  ]
}
```

CSV：

```csv
key,standard_text
PageSize.A4,A4
Duplex.DuplexNoTumble,双面打印
```

## 说明

浏览器不能在未授权的情况下扫描任意本地目录，因此 Web 版的“自动获取PPD”以打印机路径提示和手动导入为主。真实测试通过导入 PPD 文件完成。

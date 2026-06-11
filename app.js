const samplePrinters = [
  {
    id: "P001",
    name: "HP LaserJet Pro MFP",
    model: "LJ-MFP-001",
    ppdPath: "ppd/hp/LJ-MFP-001.ppd",
    source: "sample",
    languages: ["zh_CN", "zh_TW", "ja", "ko", "fr", "de"]
  },
  {
    id: "P002",
    name: "Canon imageCLASS Series",
    model: "IC-2200",
    ppdPath: "ppd/canon/IC-2200.ppd",
    source: "sample",
    languages: ["zh_CN", "ja", "en_US"]
  },
  {
    id: "P003",
    name: "Brother HL Office",
    model: "HL-5350DN",
    ppdPath: "ppd/brother/HL-5350DN.ppd",
    source: "sample",
    languages: ["zh_CN", "zh_TW", "de", "fr"]
  },
  {
    id: "P004",
    name: "Epson WorkForce",
    model: "WF-7820",
    ppdPath: "ppd/epson/WF-7820.ppd",
    source: "sample",
    languages: ["zh_CN", "ko", "es", "it"]
  }
];

const defaultConfig = {
  ppdRoot: "./ppd",
  standardRoot: "./standards",
  reportRoot: "./reports",
  encodings: ["utf-8", "gb18030", "big5"],
  ignoreTrim: true,
  ignoreCase: false,
  truncationByteLimit: 40,
  skipLeadingCompareItems: 7
};

const state = {
  printers: samplePrinters,
  selectedPrinterId: samplePrinters[0].id,
  ppdFile: null,
  ppdText: "",
  standardFile: null,
  standardItems: new Map(),
  standardLoaded: false,
  results: [],
  summary: null,
  activeFilter: "全部",
  searchText: "",
  sortKey: "index",
  sortDir: "asc",
  ocrImageFile: null,
  ocrAvailable: false,
  linuxCaptureAvailable: false,
  printerRefreshInFlight: false,
  lastPrinterSignature: "",
  config: loadConfig()
};

const languageLabels = {
  en: "英语 en",
  en_US: "英语 en_US",
  zh_CN: "简体中文 zh_CN",
  zh_TW: "繁体中文 zh_TW",
  ja: "日语 ja",
  ko: "韩语 ko",
  fr: "法语 fr",
  de: "德语 de",
  es: "西班牙语 es",
  it: "意大利语 it",
  pt: "葡萄牙语 pt",
  pt_BR: "葡萄牙语 pt_BR",
  ru: "俄语 ru",
  tr: "土耳其语 tr",
  cs: "捷克语 cs",
  th: "泰语 th",
  ar: "阿拉伯语 ar",
  pl: "波兰语 pl",
  ro: "罗马尼亚语 ro",
  he: "希伯来语 he",
  el: "希腊语 el",
  hu: "匈牙利语 hu",
  bg: "保加利亚语 bg",
  uk: "乌克兰语 uk",
  vi: "越南语 vi"
};

const ignoredCompareTags = new Set(["ImageableArea", "PaperDimension"]);

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  renderPrinters();
  renderSelectedPrinter();
  renderFilters();
  updateSummary(null);
  loadSystemPrinters({ silent: false, preserveSelection: true });
  loadOcrStatus();
  loadLinuxCaptureStatus();
});

function bindElements() {
  [
    "printer-count",
    "printer-refresh",
    "printer-refresh-status",
    "printer-search",
    "printer-list",
    "selected-printer-mark",
    "selected-printer-name",
    "selected-printer-meta",
    "selected-ppd-path",
    "language-select",
    "run-test",
    "rerun-test",
    "load-sample",
    "export-report",
    "ppd-drop-zone",
    "ppd-file-name",
    "ppd-file-input",
    "standard-drop-zone",
    "standard-file-name",
    "standard-file-input",
    "ocr-status",
    "ocr-expected-text",
    "ocr-language",
    "ocr-image-input",
    "ocr-image-name",
    "run-ocr-test",
    "ocr-result",
    "linux-capture-status",
    "linux-expected-text",
    "linux-window-title",
    "linux-roi-x",
    "linux-roi-y",
    "linux-roi-width",
    "linux-roi-height",
    "run-linux-capture",
    "linux-capture-result",
    "run-meta",
    "overall-result",
    "metric-total",
    "metric-pass",
    "metric-fail",
    "metric-warn",
    "filter-row",
    "result-search",
    "result-body",
    "detail-dialog",
    "detail-content",
    "config-dialog",
    "config-form",
    "open-config",
    "open-help",
    "open-about",
    "help-dialog",
    "about-dialog",
    "reset-config",
    "config-ppd-root",
    "config-standard-root",
    "config-report-root",
    "config-encodings",
    "config-ignore-trim",
    "config-ignore-case",
    "config-threshold",
    "export-dialog",
    "export-format",
    "export-filename",
    "confirm-export",
    "toast-stack"
  ].forEach((id) => {
    el[toCamel(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  el.printerSearch.addEventListener("input", renderPrinters);
  el.printerRefresh.addEventListener("click", () => loadSystemPrinters({ silent: false, preserveSelection: true, manual: true }));
  el.languageSelect.addEventListener("change", handleLanguageChange);
  el.runTest.addEventListener("click", runTest);
  el.rerunTest.addEventListener("click", runTest);
  el.loadSample.addEventListener("click", loadSampleData);
  el.exportReport.addEventListener("click", openExportDialog);
  el.ocrExpectedText.addEventListener("input", updateOcrButtonState);
  el.ocrLanguage.addEventListener("change", () => {
    if (!el.ocrExpectedText.value.trim()) el.ocrExpectedText.focus();
  });
  el.ocrImageInput.addEventListener("change", handleOcrImageInput);
  el.runOcrTest.addEventListener("click", runOcrTruncationCheck);
  el.linuxExpectedText.addEventListener("input", updateLinuxCaptureButtonState);
  ["linuxRoiX", "linuxRoiY", "linuxRoiWidth", "linuxRoiHeight"].forEach((key) => {
    el[key].addEventListener("input", updateLinuxCaptureButtonState);
  });
  el.runLinuxCapture.addEventListener("click", runLinuxCaptureCheck);
  el.resultSearch.addEventListener("input", (event) => {
    state.searchText = event.target.value.trim().toLowerCase();
    renderResults();
  });

  el.ppdFileInput.addEventListener("change", (event) => handleFileInput(event, "ppd"));
  el.standardFileInput.addEventListener("change", (event) => handleFileInput(event, "standard"));
  setupDropZone(el.ppdDropZone, "ppd");
  setupDropZone(el.standardDropZone, "standard");

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const sortKey = th.dataset.sort;
      if (state.sortKey === sortKey) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = sortKey;
        state.sortDir = "asc";
      }
      renderResults();
    });
  });

  el.openConfig.addEventListener("click", openConfigDialog);
  el.openHelp.addEventListener("click", () => showDialog(el.helpDialog));
  el.openAbout.addEventListener("click", () => showDialog(el.aboutDialog));
  el.resetConfig.addEventListener("click", () => {
    state.config = { ...defaultConfig };
    fillConfigForm();
    toast("已恢复默认配置", "success");
  });
  el.configForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveConfigFromForm();
    el.configDialog.close();
  });
  el.confirmExport.addEventListener("click", exportReport);
}

async function loadOcrStatus() {
  try {
    const response = await fetch("./api/ocr/status", { cache: "no-store" });
    if (!response.ok) throw new Error("OCR状态接口不可用");
    const payload = await response.json();
    state.ocrAvailable = Boolean(payload.available);
    el.ocrStatus.textContent = state.ocrAvailable
      ? `${payload.engine || "OCR"}已可用，上传控件截图即可验证。`
      : `OCR未安装：${payload.installHint || "pip install rapidocr onnxruntime"}`;
    el.ocrStatus.className = state.ocrAvailable ? "ok" : "warn";
  } catch (error) {
    state.ocrAvailable = false;
    el.ocrStatus.textContent = "未连接到OCR后端，请使用 server.py 启动工具。";
    el.ocrStatus.className = "warn";
  }
  updateOcrButtonState();
}

async function loadLinuxCaptureStatus() {
  try {
    const response = await fetch("./api/capture/linux/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Linux截图状态接口不可用");
    const payload = await response.json();
    state.linuxCaptureAvailable = Boolean(payload.available);
    if (payload.available) {
      const tools = Object.entries(payload.tools || {}).filter(([, available]) => available).map(([name]) => name).join(", ");
      el.linuxCaptureStatus.textContent = `Linux截图可用：${tools || "已检测到工具"}`;
      el.linuxCaptureStatus.className = "ok";
    } else {
      el.linuxCaptureStatus.textContent = payload.isLinux ? payload.hint : "当前不是Linux环境，部署到Linux后可用。";
      el.linuxCaptureStatus.className = "warn";
    }
  } catch (error) {
    state.linuxCaptureAvailable = false;
    el.linuxCaptureStatus.textContent = "未连接到截图后端，请使用 server.py 启动工具。";
    el.linuxCaptureStatus.className = "warn";
  }
  updateLinuxCaptureButtonState();
}

function handleOcrImageInput(event) {
  const file = event.target.files?.[0] || null;
  state.ocrImageFile = file;
  el.ocrImageName.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "建议上传单个控件的裁剪图，右边界即控件边界。";
  updateOcrButtonState();
}

function updateOcrButtonState() {
  const hasExpected = Boolean(el.ocrExpectedText?.value.trim());
  el.runOcrTest.disabled = !(state.ocrAvailable && state.ocrImageFile && hasExpected);
}

function updateLinuxCaptureButtonState() {
  const hasExpected = Boolean(el.linuxExpectedText?.value.trim());
  const hasRoi = [el.linuxRoiX, el.linuxRoiY, el.linuxRoiWidth, el.linuxRoiHeight].every((input) => input.value !== "" && Number(input.value) >= 0);
  el.runLinuxCapture.disabled = !(state.ocrAvailable && state.linuxCaptureAvailable && hasExpected && hasRoi);
}

async function runOcrTruncationCheck() {
  if (!state.ocrAvailable) {
    toast("当前环境未安装OCR引擎", "warn");
    return;
  }
  if (!state.ocrImageFile || !el.ocrExpectedText.value.trim()) {
    toast("请先选择截图并输入期望完整字符串", "warn");
    return;
  }

  const form = new FormData();
  form.append("image", state.ocrImageFile);
  form.append("expected_text", el.ocrExpectedText.value.trim());
  form.append("language", el.ocrLanguage.value || el.languageSelect.value);

  el.runOcrTest.disabled = true;
  el.runOcrTest.textContent = "OCR识别中";
  el.ocrResult.textContent = "正在调用OCR引擎识别截图...";

  try {
    const response = await fetch("./api/ocr/truncation", {
      method: "POST",
      body: form
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.installHint || "OCR识别失败");
    }
    renderOcrResult(payload);
  } catch (error) {
    el.ocrResult.innerHTML = `<strong class="ocr-verdict fail">OCR不可用</strong><p>${escapeHtml(error.message)}</p>`;
    toast(error.message || "OCR识别失败", "error");
  } finally {
    el.runOcrTest.textContent = "OCR截断判断";
    updateOcrButtonState();
  }
}

function renderOcrResult(payload) {
  renderOcrResultTo(el.ocrResult, payload);
}

async function runLinuxCaptureCheck() {
  if (!state.linuxCaptureAvailable) {
    toast("当前环境不可用Linux自动截图", "warn");
    return;
  }
  if (!state.ocrAvailable) {
    toast("当前环境未安装OCR引擎", "warn");
    return;
  }

  const body = {
    expected_text: el.linuxExpectedText.value.trim(),
    language: el.ocrLanguage.value || el.languageSelect.value,
    window_title: el.linuxWindowTitle.value.trim(),
    roi: {
      x: Number(el.linuxRoiX.value),
      y: Number(el.linuxRoiY.value),
      width: Number(el.linuxRoiWidth.value),
      height: Number(el.linuxRoiHeight.value)
    }
  };

  el.runLinuxCapture.disabled = true;
  el.runLinuxCapture.textContent = "截图比对中";
  el.linuxCaptureResult.textContent = "正在截图、裁剪并调用OCR...";

  try {
    const response = await fetch("./api/capture/linux/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.status?.hint || "Linux截图比对失败");
    }
    renderLinuxCaptureResult(payload);
  } catch (error) {
    el.linuxCaptureResult.innerHTML = `<strong class="ocr-verdict fail">截图比对不可用</strong><p>${escapeHtml(error.message)}</p>`;
    toast(error.message || "Linux截图比对失败", "error");
  } finally {
    el.runLinuxCapture.textContent = "截图并比对";
    updateLinuxCaptureButtonState();
  }
}

function renderLinuxCaptureResult(payload) {
  renderOcrResultTo(el.linuxCaptureResult, payload, {
    extra: `
      <dt>截图工具</dt><dd>${escapeHtml(payload.capture?.tool || "-")}</dd>
      <dt>ROI</dt><dd>x=${escapeHtml(payload.roi?.x ?? "-")} y=${escapeHtml(payload.roi?.y ?? "-")} w=${escapeHtml(payload.roi?.width ?? "-")} h=${escapeHtml(payload.roi?.height ?? "-")}</dd>
      <dt>裁剪预览</dt><dd>${payload.cropDataUrl ? `<img class="capture-preview" src="${escapeAttr(payload.cropDataUrl)}" alt="裁剪预览" />` : "-"}</dd>
    `
  });
}

function renderOcrResultTo(container, payload, options = {}) {
  const verdictMap = {
    pass: ["未截断", "pass"],
    truncated: ["截断", "fail"],
    suspected_truncated: ["疑似截断", "warn"],
    low_confidence: ["低置信", "warn"],
    no_text: ["未识别到文字", "warn"],
    mismatch: ["文本不匹配", "fail"],
    needs_review: ["待人工确认", "warn"]
  };
  const [label, tone] = verdictMap[payload.verdict] || ["待人工确认", "warn"];
  const detections = payload.detections || [];
  const boxes = detections
    .map((item) => `${item.text} (${Math.round(item.box?.[0] || 0)},${Math.round(item.box?.[1] || 0)}-${Math.round(item.box?.[2] || 0)},${Math.round(item.box?.[3] || 0)})`)
    .join("；");

  container.innerHTML = `
    <div class="ocr-result-head">
      <strong class="ocr-verdict ${tone}">${escapeHtml(label)}</strong>
      <span>${escapeHtml(payload.engine || "OCR")} · ${escapeHtml(payload.language || "")}</span>
    </div>
    <dl class="ocr-result-grid">
      <dt>期望文本</dt><dd>${escapeHtml(payload.expectedText || "")}</dd>
      <dt>OCR文本</dt><dd>${escapeHtml(payload.recognizedText || "") || "-"}</dd>
      <dt>判断依据</dt><dd>${escapeHtml(payload.message || "")}</dd>
      <dt>平均置信度</dt><dd>${formatPercent(payload.averageScore)}</dd>
      <dt>相似度</dt><dd>${formatPercent(payload.similarity)}</dd>
      <dt>贴右边界</dt><dd>${payload.touchesRightEdge ? "是" : "否"}${payload.rightMargin != null ? ` · 右边距 ${payload.rightMargin.toFixed(1)}px` : ""}</dd>
      <dt>省略号</dt><dd>${payload.hasEllipsis ? "是" : "否"}</dd>
      <dt>识别框</dt><dd>${escapeHtml(boxes || "无")}</dd>
      ${options.extra || ""}
    </dl>
  `;
}

function renderPrinters() {
  const query = el.printerSearch.value.trim().toLowerCase();
  const printers = state.printers.filter((printer) => {
    return `${printer.name} ${printer.model}`.toLowerCase().includes(query);
  });

  el.printerCount.textContent = String(printers.length);
  el.printerList.innerHTML = "";

  if (!printers.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "未找到匹配打印机";
    el.printerList.append(empty);
    return;
  }

  printers.forEach((printer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `printer-item${printer.id === state.selectedPrinterId ? " active" : ""}`;
    button.innerHTML = `
      ${printerIconHtml(printer, "printer-icon")}
      <span>
        <strong>${escapeHtml(printer.name)}</strong>
        <span>${escapeHtml(printer.model || printer.queueName || printer.id)} · ${escapeHtml(printer.status || "")}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      selectPrinter(printer.id);
    });
    el.printerList.append(button);
  });
}

function renderSelectedPrinter() {
  const printer = selectedPrinter();
  if (!printer) {
    el.selectedPrinterMark.textContent = "PP";
    el.selectedPrinterName.textContent = "未选择打印机";
    el.selectedPrinterMeta.textContent = "请选择左侧打印机，或直接导入PPD后运行测试。";
    el.selectedPpdPath.textContent = "PPD路径：未加载";
    return;
  }
  el.selectedPrinterMark.outerHTML = printerIconHtml(printer, "printer-mark", "selected-printer-mark");
  el.selectedPrinterMark = document.getElementById("selected-printer-mark");
  el.selectedPrinterName.textContent = printer.name;
  el.selectedPrinterMeta.textContent = `型号：${printer.model || "-"} · 队列：${printer.queueName || printer.id} · ${printer.status || "已加载"} · 语言：${el.languageSelect.value}`;
  el.selectedPpdPath.textContent = `PPD路径：${state.ppdFile ? state.ppdFile.name : printer.ppdPath || "未找到本地PPD"}`;
}

async function loadSystemPrinters(options = {}) {
  const { silent = true, preserveSelection = true, manual = false } = options;
  if (state.printerRefreshInFlight) return;
  state.printerRefreshInFlight = true;
  setPrinterRefreshStatus(manual ? "正在刷新打印机列表..." : "正在同步CUPS打印机...");

  try {
    const response = await fetch("./api/printers", { cache: "no-store" });
    if (!response.ok) throw new Error("无法获取CUPS打印机列表");
    const payload = await response.json();
    if (!payload.printers?.length) {
      setPrinterRefreshStatus(`未发现CUPS打印机，继续显示样例 · ${formatClock(new Date())}`, "warn");
      if (!silent || manual) toast("CUPS未返回打印机，当前使用内置样例列表", "warn");
      return;
    }

    const nextPrinters = payload.printers.map(normalizePrinter);
    const previousSignature = state.lastPrinterSignature || printerListSignature(state.printers);
    const nextSignature = printerListSignature(nextPrinters);
    const changed = previousSignature !== nextSignature;
    const previousSelectedId = state.selectedPrinterId;
    const selectedStillExists = nextPrinters.some((printer) => printer.id === previousSelectedId);

    state.printers = nextPrinters;
    state.lastPrinterSignature = nextSignature;
    if (!preserveSelection || !selectedStillExists) {
      state.selectedPrinterId = state.printers[0].id;
    }

    renderPrinters();
    renderSelectedPrinter();
    setPrinterRefreshStatus(`已同步 ${state.printers.length} 台打印机 · ${formatClock(new Date())}`, "ok");

    const selectedChanged = previousSelectedId !== state.selectedPrinterId;
    if (selectedChanged || !state.ppdText) {
      await loadPrinterPpd(state.selectedPrinterId);
    }

    if (!silent || manual || changed) {
      const message = changed ? `打印机列表已更新：${state.printers.length} 台` : `已刷新 ${state.printers.length} 台打印机`;
      toast(message, "success");
    }
  } catch (error) {
    console.warn(error);
    setPrinterRefreshStatus(`CUPS连接失败，保留当前列表 · ${formatClock(new Date())}`, "warn");
    if (!silent || manual) toast("未连接到本地CUPS服务，保留当前列表", "warn");
  } finally {
    state.printerRefreshInFlight = false;
  }
}

function printerListSignature(printers) {
  return printers
    .map((printer) => `${printer.id}|${printer.name}|${printer.model}|${printer.ppdPath}|${printer.iconPath}`)
    .sort()
    .join("\n");
}

function setPrinterRefreshStatus(message, tone = "") {
  if (!el.printerRefreshStatus) return;
  el.printerRefreshStatus.textContent = message;
  el.printerRefreshStatus.className = `printer-refresh-status${tone ? ` ${tone}` : ""}`;
}

async function selectPrinter(printerId) {
  state.selectedPrinterId = printerId;
  renderPrinters();
  renderSelectedPrinter();
  await loadPrinterPpd(printerId);
}

async function loadPrinterPpd(printerId) {
  const printer = state.printers.find((item) => item.id === printerId);
  if (!printer || printer.source === "sample") return;
  if (!printer.ppdPath) {
    state.ppdText = "";
    state.ppdFile = null;
    el.ppdFileName.textContent = "该打印机未找到本地PPD，可手动选择PPD。";
    renderSelectedPrinter();
    return;
  }

  try {
    const response = await fetch(`./api/printers/${encodeURIComponent(printerId)}/ppd`, { cache: "no-store" });
    if (!response.ok) throw new Error("对应PPD读取失败");
    const payload = await response.json();
    state.ppdText = payload.ppdText;
    state.ppdFile = { name: payload.fileName, size: payload.size };
    updateLanguageOptionsFromPpd(state.ppdText);
    el.ppdFileName.textContent = `${payload.fileName} · ${formatBytes(payload.size)} · 来自 ${printer.ppdPath}`;
    renderSelectedPrinter();
    toast(`已提取 ${printer.name} 对应PPD`, "success");
  } catch (error) {
    console.error(error);
    state.ppdText = "";
    state.ppdFile = null;
    el.ppdFileName.textContent = "对应PPD读取失败，可手动选择PPD。";
    renderSelectedPrinter();
    toast(error.message || "对应PPD读取失败", "error");
  }
}

async function handleFileInput(event, kind) {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadFile(file, kind);
  event.target.value = "";
}

async function handleLanguageChange() {
  renderSelectedPrinter();
  await refreshExcelStandardForLanguage();
}

async function refreshExcelStandardForLanguage(options = {}) {
  if (!state.standardFile || !isExcelFile(state.standardFile)) return;
  try {
    const items = await parseExcelStandardLibrary(state.standardFile);
    state.standardItems = items;
    state.standardLoaded = true;
    el.standardFileName.textContent = `${state.standardFile.name} · ${items.size} 条标准项`;
    if (!options.silent) toast("已按当前语言更新Excel标准库", "success");
  } catch (error) {
    console.error(error);
    if (!options.silent) toast(error.message || "Excel标准库重新解析失败", "error");
  }
}

function setupDropZone(zone, kind) {
  zone.addEventListener("click", (event) => {
    if (event.target.tagName !== "INPUT" && !event.target.closest(".file-button")) {
      const input = kind === "ppd" ? el.ppdFileInput : el.standardFileInput;
      input.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("dragging");
    });
  });

  zone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer.files?.[0];
    if (file) await loadFile(file, kind);
  });
}

async function loadFile(file, kind) {
  try {
    if (kind === "ppd") {
      const text = await readTextFile(file);
      state.ppdFile = file;
      state.ppdText = text;
      updateLanguageOptionsFromPpd(state.ppdText);
      el.ppdFileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
      renderSelectedPrinter();
      toast("PPD文件加载成功", "success");
      return;
    }

    const items = isExcelFile(file) ? await parseExcelStandardLibrary(file) : parseStandardLibrary(await readTextFile(file), file.name);
    state.standardFile = file;
    state.standardItems = items;
    state.standardLoaded = true;
    el.standardFileName.textContent = `${file.name} · ${items.size} 条标准项`;
    toast("标准内容库加载成功", "success");
  } catch (error) {
    console.error(error);
    toast(error.message || "文件加载失败", "error");
  }
}

async function loadSampleData() {
  try {
    const [ppdResponse, standardResponse] = await Promise.all([
      fetch("./sample.ppd"),
      fetch("./sample-standard.json")
    ]);

    if (!ppdResponse.ok || !standardResponse.ok) {
      throw new Error("样例文件加载失败");
    }

    state.ppdText = await ppdResponse.text();
    state.ppdFile = { name: "sample.ppd", size: state.ppdText.length };
    updateLanguageOptionsFromPpd(state.ppdText);
    const standardText = await standardResponse.text();
    state.standardItems = parseStandardLibrary(standardText, "sample-standard.json");
    state.standardLoaded = true;
    state.standardFile = { name: "sample-standard.json", size: standardText.length };

    el.ppdFileName.textContent = `sample.ppd · ${formatBytes(state.ppdFile.size)}`;
    el.standardFileName.textContent = `sample-standard.json · ${state.standardItems.size} 条标准项`;
    renderSelectedPrinter();
    toast("样例数据已加载", "success");
  } catch (error) {
    console.error(error);
    toast(error.message || "样例加载失败", "error");
  }
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => {
      const buffer = reader.result;
      const encodings = unique(["utf-8", ...state.config.encodings]);
      for (const encoding of encodings) {
        try {
          const decoder = new TextDecoder(encoding, { fatal: false });
          const text = decoder.decode(buffer);
          if (!hasSevereDecodeIssue(text)) {
            resolve(text);
            return;
          }
        } catch {
          // Try next configured encoding.
        }
      }
      try {
        resolve(new TextDecoder("utf-8").decode(buffer));
      } catch {
        reject(new Error("无法按配置编码解析文件"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function runTest() {
  if (!state.ppdText) {
    toast("请先导入PPD文件", "warn");
    return;
  }

  setBusy(true, "正在解析PPD");
  window.setTimeout(() => {
    try {
      const language = el.languageSelect.value;
      const compareScope = buildCompareScope(extractLocalizedItems(parsePpd(state.ppdText), language), state.standardItems);
      const compared = compareItems(compareScope.actualItems, compareScope.standardItems);
      state.results = compared.results.map((item, index) => ({ ...item, index: index + 1 }));
      state.summary = buildSummary(state.results);
      updateSummary(state.summary);
      renderFilters();
      renderResults();
      el.rerunTest.disabled = false;
      el.exportReport.disabled = state.results.length === 0;
      setBusy(false);
      toast(`测试完成：${state.summary.total} 项`, "success");
    } catch (error) {
      console.error(error);
      setBusy(false);
      toast(error.message || "测试失败", "error");
    }
  }, 80);
}

function parsePpd(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items = [];
  const languageEncoding = findLanguageEncoding(lines);

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (!line.startsWith("*") || line.startsWith("*%")) return;

    const match = line.match(/^\*([^\s/:]+)(?:\s+([^/:]+))?(?:\/([^:]+))?\s*:\s*(.*)$/);
    if (!match) return;

    const [, rawTag, rawOption = "", rawLabel = "", rawValue = ""] = match;
    const tagInfo = splitLocalizedTag(rawTag);
    const tag = stripAsterisk(tagInfo.tag);
    const option = stripAsterisk(rawOption.trim());
    const label = cleanPpdText(rawLabel);
    const value = cleanPpdText(rawValue);
    const key = buildPpdKey(tag, option);
    const actualText = chooseActualText(tag, option, label, value);

    if (!actualText) return;

    items.push({
      language: tagInfo.language,
      tag,
      option,
      key,
      category: categorize(tag, option),
      actualText,
      lineNo,
      rawText: raw,
      encoding: languageEncoding
    });
  });

  return items;
}

function updateLanguageOptionsFromPpd(ppdText) {
  const languages = extractPpdLanguages(ppdText);
  if (!languages.length) return;

  const current = el.languageSelect.value;
  el.languageSelect.innerHTML = "";
  languages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = languageLabels[language] || language;
    el.languageSelect.append(option);
  });

  const nextLanguage = languages.includes(current)
    ? current
    : languages.includes("zh_CN")
      ? "zh_CN"
      : languages.includes("en")
        ? "en"
        : languages[0];
  const changed = el.languageSelect.value !== nextLanguage;
  el.languageSelect.value = nextLanguage;
  if (changed) refreshExcelStandardForLanguage({ silent: true });
}

function extractPpdLanguages(ppdText) {
  const lines = String(ppdText || "").replace(/\r\n?/g, "\n").split("\n");
  const cupsLine = lines.find((line) => /^\*cupsLanguages\s*:/i.test(line.trim()));
  if (cupsLine) {
    const value = cleanPpdText(cupsLine.split(":").slice(1).join(":"));
    const languages = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    return unique(languages);
  }

  const languages = [];
  lines.forEach((line) => {
    const match = line.trim().match(/^\*([a-z]{2,3}(?:_[A-Z]{2})?)\./);
    if (match) languages.push(match[1]);
  });
  return unique(languages);
}

function extractLocalizedItems(parsed, language) {
  const bestByKey = new Map();

  parsed.forEach((item) => {
    const rank = item.language === language ? 3 : item.language ? 1 : 2;
    const existing = bestByKey.get(item.key);
    if (!existing || rank > existing.rank || (rank === existing.rank && item.lineNo < existing.item.lineNo)) {
      bestByKey.set(item.key, { rank, item });
    }
  });

  return Array.from(bestByKey.values()).map(({ item }) => item);
}

function compareItems(actualItems, standardItems) {
  const results = [];
  const actualByKey = new Map(actualItems.map((item) => [item.key, item]));
  const allKeys = new Set([...actualByKey.keys(), ...standardItems.keys()]);

  allKeys.forEach((key) => {
    const actual = actualByKey.get(key);
    const standardText = standardItems.get(key) || "";
    const actualText = actual?.actualText || "";
    const category = actual?.category || "标准缺失项";
    const lineNo = actual?.lineNo || "";
    const rawText = actual?.rawText || "";
    const result = judgeItem(standardText, actualText, Boolean(actual), standardItems.has(key));

    results.push({
      category,
      key,
      standardText,
      actualText,
      status: result.status,
      exceptionType: result.exceptionType,
      lineNo,
      rawText,
      note: result.note,
      reason: result.reason
    });
  });

  return { results };
}

function buildCompareScope(actualItems, standardItems) {
  const skipCount = Number(state.config.skipLeadingCompareItems || 0);
  const leadingSkippedKeys = new Set(actualItems.slice(0, skipCount).map((item) => item.key));
  const ignoredKeys = new Set(
    actualItems
      .filter((item) => ignoredCompareTags.has(item.tag))
      .map((item) => item.key)
  );
  const skippedKeys = new Set([...leadingSkippedKeys, ...ignoredKeys]);
  const scopedStandardItems = new Map(
    Array.from(standardItems.entries()).filter(([key]) => !skippedKeys.has(key))
  );

  return {
    actualItems: actualItems.slice(skipCount).filter((item) => !ignoredCompareTags.has(item.tag)),
    standardItems: scopedStandardItems,
    skippedKeys
  };
}

function judgeItem(standardText, actualText, hasActual, hasStandard) {
  if (!hasStandard && hasActual) {
    if (!state.standardLoaded) {
      return {
        status: "警告",
        exceptionType: "待人工确认",
        note: "未导入标准库，需人工确认",
        reason: "浏览器已提取到PPD字段，但没有标准内容库可用于自动判定。"
      };
    }

    return {
      status: "警告",
      exceptionType: "多余内容",
      note: "标准库中未找到对应Key",
      reason: "实际PPD存在该字段，但标准内容库没有对应项。"
    };
  }

  if (hasStandard && !hasActual) {
    return {
      status: "失败",
      exceptionType: "缺失",
      note: "标准存在，PPD未提取到实际内容",
      reason: "标准内容库包含该Key，但PPD中未发现对应本地化字段。"
    };
  }

  const normalizedStandard = normalizeCompareText(standardText);
  const normalizedActual = normalizeCompareText(actualText);

  if (isTruncated(standardText, actualText)) {
    const actualBytes = textByteLength(actualText);
    return {
      status: "失败",
      exceptionType: "截断",
      note: `实际内容 ${actualBytes} 字节，超过 ${state.config.truncationByteLimit} 字节上限`,
      reason: `按当前规则，PPD实际文本的UTF-8字节长度必须不大于 ${state.config.truncationByteLimit} 字节。`
    };
  }

  if (normalizedStandard === normalizedActual) {
    return {
      status: "通过",
      exceptionType: "无",
      note: "完全一致",
      reason: "标准内容与实际内容一致。"
    };
  }

  if (isMojibake(actualText)) {
    return {
      status: "失败",
      exceptionType: "乱码",
      note: "检测到替代字符或常见乱码特征",
      reason: "实际内容包含Unicode替代字符、异常控制字符或常见编码错读片段。"
    };
  }

  if (!samePlaceholders(standardText, actualText)) {
    return {
      status: "失败",
      exceptionType: "格式异常",
      note: "占位符或特殊标记不一致",
      reason: "标准内容和实际内容中的占位符集合不一致。"
    };
  }

  return {
    status: "失败",
    exceptionType: "错误翻译",
    note: "内容不一致",
    reason: "标准内容与实际内容不一致，且未命中特殊异常规则。"
  };
}

function buildSummary(results) {
  const total = results.length;
  const pass = results.filter((item) => item.status === "通过").length;
  const fail = results.filter((item) => item.status === "失败").length;
  const warn = results.filter((item) => item.status === "警告").length;
  return {
    total,
    pass,
    fail,
    warn,
    startedAt: new Date(),
    overall: fail > 0 ? "失败" : warn > 0 ? "有警告" : total > 0 ? "通过" : "待测试"
  };
}

function updateSummary(summary) {
  el.metricTotal.textContent = String(summary?.total || 0);
  el.metricPass.textContent = String(summary?.pass || 0);
  el.metricFail.textContent = String(summary?.fail || 0);
  el.metricWarn.textContent = String(summary?.warn || 0);

  if (!summary) {
    el.runMeta.textContent = "尚未运行测试";
    el.overallResult.textContent = "待测试";
    el.overallResult.className = "overall pending";
    return;
  }

  const printer = selectedPrinter();
  el.runMeta.textContent = `${printer?.name || "手动PPD"} · ${el.languageSelect.value} · ${formatDate(summary.startedAt)}`;
  el.overallResult.textContent = summary.overall;
  el.overallResult.className = `overall ${summary.fail ? "fail" : "pass"}`;
}

function renderFilters() {
  const filters = ["全部", "通过", "失败", "警告", "缺失", "截断", "乱码", "格式异常", "待人工确认"];
  const counts = getFilterCounts();
  el.filterRow.innerHTML = "";
  filters.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-button${state.activeFilter === filter ? " active" : ""}`;
    button.textContent = `${filter} ${counts[filter] || 0}`;
    button.addEventListener("click", () => {
      state.activeFilter = filter;
      renderFilters();
      renderResults();
    });
    el.filterRow.append(button);
  });
}

function renderResults() {
  const rows = filteredResults().sort(sortResults);
  el.resultBody.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="9" class="empty-state">${state.results.length ? "当前筛选条件下无数据" : "暂无测试结果"}</td>`;
    el.resultBody.append(row);
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement("tr");
    row.className = item.status === "失败" ? "row-fail" : item.status === "警告" ? "row-warn" : "";
    row.innerHTML = `
      <td>${item.index}</td>
      <td>${escapeHtml(item.category)}</td>
      <td class="key-cell">${escapeHtml(item.key)}</td>
      <td class="text-cell" title="${escapeAttr(item.standardText)}">${diffHtml(item.standardText, item.actualText, "standard")}</td>
      <td class="text-cell" title="${escapeAttr(item.actualText)}">${diffHtml(item.standardText, item.actualText, "actual")}</td>
      <td><span class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.exceptionType)}</td>
      <td>${escapeHtml(String(item.lineNo || "-"))}</td>
      <td class="text-cell" title="${escapeAttr(item.note)}">${escapeHtml(item.note)}</td>
    `;
    row.addEventListener("click", () => openDetail(item));
    el.resultBody.append(row);
  });
}

function filteredResults() {
  return state.results.filter((item) => {
    const filter = state.activeFilter;
    const matchesFilter =
      filter === "全部" ||
      item.status === filter ||
      item.exceptionType === filter ||
      (filter === "待人工确认" && item.exceptionType === "待人工确认");
    if (!matchesFilter) return false;
    if (!state.searchText) return true;
    return [
      item.category,
      item.key,
      item.standardText,
      item.actualText,
      item.status,
      item.exceptionType,
      item.note
    ].join(" ").toLowerCase().includes(state.searchText);
  });
}

function sortResults(a, b) {
  const key = state.sortKey;
  const aValue = a[key] ?? "";
  const bValue = b[key] ?? "";
  const direction = state.sortDir === "asc" ? 1 : -1;
  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * direction;
  }
  return String(aValue).localeCompare(String(bValue), "zh-Hans-CN") * direction;
}

function openDetail(item) {
  el.detailContent.innerHTML = `
    <dl class="detail-grid">
      <dt>字段分类</dt><dd>${escapeHtml(item.category)}</dd>
      <dt>Key</dt><dd><code>${escapeHtml(item.key)}</code></dd>
      <dt>所属打印机</dt><dd>${escapeHtml(selectedPrinter()?.name || "手动PPD")}</dd>
      <dt>标准内容</dt><dd>${diffHtml(item.standardText, item.actualText, "standard") || "-"}</dd>
      <dt>实际内容</dt><dd>${diffHtml(item.standardText, item.actualText, "actual") || "-"}</dd>
      <dt>状态</dt><dd><span class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></dd>
      <dt>异常类型</dt><dd>${escapeHtml(item.exceptionType)}</dd>
      <dt>行号</dt><dd>${escapeHtml(String(item.lineNo || "-"))}</dd>
      <dt>判定原因</dt><dd>${escapeHtml(item.reason || item.note)}</dd>
      <dt>建议处理</dt><dd>${escapeHtml(suggestFix(item))}</dd>
      <dt>原始PPD行</dt><dd><div class="raw-line">${escapeHtml(item.rawText || "无")}</div></dd>
    </dl>
  `;
  showDialog(el.detailDialog);
}

function openConfigDialog() {
  fillConfigForm();
  showDialog(el.configDialog);
}

function fillConfigForm() {
  el.configPpdRoot.value = state.config.ppdRoot;
  el.configStandardRoot.value = state.config.standardRoot;
  el.configReportRoot.value = state.config.reportRoot;
  el.configEncodings.value = state.config.encodings.join(",");
  el.configIgnoreTrim.checked = state.config.ignoreTrim;
  el.configIgnoreCase.checked = state.config.ignoreCase;
  el.configThreshold.value = state.config.truncationByteLimit;
}

function saveConfigFromForm() {
  state.config = {
    ppdRoot: el.configPpdRoot.value.trim() || defaultConfig.ppdRoot,
    standardRoot: el.configStandardRoot.value.trim() || defaultConfig.standardRoot,
    reportRoot: el.configReportRoot.value.trim() || defaultConfig.reportRoot,
    encodings: el.configEncodings.value.split(",").map((item) => item.trim()).filter(Boolean),
    ignoreTrim: el.configIgnoreTrim.checked,
    ignoreCase: el.configIgnoreCase.checked,
    truncationByteLimit: Number(el.configThreshold.value) || defaultConfig.truncationByteLimit
  };
  localStorage.setItem("ppd-localization-config", JSON.stringify(state.config));
  toast("配置已保存", "success");
}

function openExportDialog() {
  const printer = selectedPrinter();
  const stamp = compactDate(new Date());
  const model = sanitizeFilename(printer?.model || state.ppdFile?.name || "manual");
  el.exportFilename.value = `PPD本地化测试报告_${model}_${el.languageSelect.value}_${stamp}.md`;
  showDialog(el.exportDialog);
}

function exportReport() {
  if (!state.results.length) {
    toast("暂无可导出的测试结果", "warn");
    return;
  }

  const format = el.exportFormat.value;
  let filename = el.exportFilename.value.trim();
  if (!filename) filename = "PPD本地化测试报告.md";
  filename = ensureExtension(filename, format === "html" ? ".html" : ".md");

  const content = format === "html" ? buildHtmlReport() : buildMarkdownReport();
  const blob = new Blob([content], { type: format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  el.exportDialog.close();
  toast("测试报告导出成功", "success");
}

function buildMarkdownReport() {
  const printer = selectedPrinter();
  const summary = state.summary || buildSummary(state.results);
  const issueRows = state.results.filter((item) => item.status !== "通过");
  const rows = issueRows.length ? issueRows : state.results;

  return [
    "# PPD本地化测试报告",
    "",
    "## 基本信息",
    `- 打印机名称：${printer?.name || "手动PPD"}`,
    `- 打印机型号：${printer?.model || "-"}`,
    `- 语言：${el.languageSelect.value}`,
    `- PPD文件：${state.ppdFile?.name || printer?.ppdPath || "-"}`,
    `- 标准库：${state.standardFile?.name || "未导入"}`,
    `- 比对范围：已跳过前 ${state.config.skipLeadingCompareItems} 个PPD提取项`,
    `- 忽略属性：${Array.from(ignoredCompareTags).join(", ")}`,
    `- 截断规则：实际文本不大于 ${state.config.truncationByteLimit} 字节`,
    `- 测试时间：${formatDate(summary.startedAt || new Date())}`,
    "",
    "## 测试摘要",
    `- 总检查项：${summary.total}`,
    `- 通过：${summary.pass}`,
    `- 失败：${summary.fail}`,
    `- 警告：${summary.warn}`,
    `- 总体结果：${summary.overall}`,
    "",
    "## 问题明细",
    "| 序号 | 分类 | Key | 标准内容 | 实际内容 | 结果 | 异常类型 | 行号 | 备注 |",
    "|---:|---|---|---|---|---|---|---:|---|",
    ...rows.map((item) => {
      return `| ${item.index} | ${mdCell(item.category)} | ${mdCell(item.key)} | ${mdCell(item.standardText)} | ${mdCell(item.actualText)} | ${mdCell(item.status)} | ${mdCell(item.exceptionType)} | ${mdCell(item.lineNo || "-")} | ${mdCell(item.note)} |`;
    }),
    "",
    "## 结论",
    summary.fail > 0
      ? "本次PPD本地化测试未通过，请优先处理失败项并回归验证。"
      : summary.warn > 0
        ? "本次PPD本地化测试存在警告项，建议人工确认后归档。"
        : "本次PPD本地化测试通过。"
  ].join("\n");
}

function buildHtmlReport() {
  const markdown = buildMarkdownReport();
  const lines = markdown.split("\n");
  const body = lines.map((line) => {
    if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith("- ")) return `<p>${escapeHtml(line)}</p>`;
    if (line.startsWith("|")) return `<pre>${escapeHtml(line)}</pre>`;
    return line ? `<p>${escapeHtml(line)}</p>` : "";
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PPD本地化测试报告</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.6;margin:32px;color:#18202a}pre{background:#f4f6f8;padding:6px;overflow:auto}</style><body>${body}</body></html>`;
}

function parseStandardLibrary(text, filename) {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseStandardCsv(text);
  }

  try {
    const json = JSON.parse(text);
    return parseStandardJson(json);
  } catch (error) {
    if (text.includes(",")) return parseStandardCsv(text);
    throw new Error("标准库格式不正确，请使用Excel、JSON或CSV");
  }
}

function isExcelFile(file) {
  const name = (file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xlsm");
}

async function parseExcelStandardLibrary(file) {
  const form = new FormData();
  form.append("standard", file);
  form.append("language", el.languageSelect.value || "zh_CN");

  const response = await fetch("./api/standard/parse", {
    method: "POST",
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Excel标准库解析失败");
  }

  const map = new Map();
  (payload.items || []).forEach((item) => {
    const keys = String(item.key || "")
      .split(/[;；]/)
      .map((key) => key.trim())
      .filter(Boolean);
    keys.forEach((key) => {
      if (item.standard_text != null) map.set(key, String(item.standard_text));
    });
  });
  if (!map.size) throw new Error("Excel标准库未解析到PPD Key和标准文本");
  return map;
}

function parseStandardJson(json) {
  const map = new Map();
  const candidates = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : null;

  if (candidates) {
    candidates.forEach((item) => {
      const key = item.key || item.id || item.standard_key;
      const value = item.standard_text || item.standardText || item.text || item.value;
      if (key && value != null) map.set(String(key), String(value));
    });
    return map;
  }

  Object.entries(json).forEach(([key, value]) => {
    if (typeof value === "string" || typeof value === "number") {
      map.set(key, String(value));
    } else if (value && typeof value === "object") {
      const nestedValue = value.standard_text || value.standardText || value.text || value.value;
      if (nestedValue != null) map.set(key, String(nestedValue));
    }
  });

  return map;
}

function parseStandardCsv(text) {
  const rows = parseCsvRows(text);
  const map = new Map();
  if (!rows.length) return map;

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const keyIndex = findHeaderIndex(headers, ["key", "standard_key", "标准标识"]);
  const textIndex = findHeaderIndex(headers, ["standard_text", "standardtext", "text", "value", "标准内容"]);

  rows.slice(1).forEach((row) => {
    const key = row[keyIndex >= 0 ? keyIndex : 0];
    const value = row[textIndex >= 0 ? textIndex : 1];
    if (key && value != null) map.set(String(key).trim(), String(value).trim());
  });

  return map;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((line) => line.some((cellValue) => cellValue.trim() !== ""));
}

function splitLocalizedTag(rawTag) {
  const match = rawTag.match(/^([a-z]{2,3}(?:_[A-Z]{2})?)\.(.+)$/);
  if (!match) return { language: "", tag: rawTag };
  return { language: match[1], tag: match[2] };
}

function buildPpdKey(tag, option) {
  const cleanTag = stripAsterisk(tag);
  const cleanOption = stripAsterisk(option);
  if (cleanTag === "Translation") return cleanOption || cleanTag;
  if (cleanTag === "OpenUI" || cleanTag === "CloseUI") return cleanOption || cleanTag;
  if (!cleanOption) return cleanTag;
  return `${cleanTag}.${cleanOption}`;
}

function chooseActualText(tag, option, label, value) {
  if (label) return label;
  const valueTags = new Set(["ModelName", "NickName", "ShortNickName", "Product", "Manufacturer"]);
  if (valueTags.has(tag)) return value;
  return "";
}

function cleanPpdText(value) {
  return String(value || "")
    .trim()
    .replace(/^<\*|\*>$/g, "")
    .replace(/^"|"$/g, "")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\s+/g, " ");
}

function categorize(tag, option) {
  if (["ModelName", "NickName", "ShortNickName", "Product", "Manufacturer"].includes(tag)) return "打印机显示名称";
  if (tag === "Translation" && !option.includes(".")) return "菜单项名称";
  if (tag === "OpenUI" || tag === "CloseUI") return "菜单项名称";
  if (["PageSize", "PageRegion", "MediaSize"].includes(tag)) return "纸张名称";
  if (["Resolution", "PrintQuality", "cupsPrintQuality"].includes(tag)) return "打印质量选项";
  if (["Duplex", "JCLDuplex", "EFDuplex"].includes(tag)) return "双面打印描述";
  if (["ColorModel", "ColorMode", "MonoColor"].includes(tag)) return "颜色模式描述";
  if (["InputSlot", "MediaType", "OutputBin"].includes(tag)) return "纸张/进纸选项";
  if (tag.toLowerCase().includes("install")) return "安装选项描述";
  return option ? "选项描述" : "其他可见字段";
}

function findLanguageEncoding(lines) {
  const line = lines.find((item) => item.trim().startsWith("*LanguageEncoding"));
  return line ? cleanPpdText(line.split(":").slice(1).join(":")) : "未声明";
}

function normalizeCompareText(value) {
  let text = String(value || "");
  if (state.config.ignoreTrim) text = text.trim();
  if (state.config.ignoreCase) text = text.toLowerCase();
  return text;
}

function isMojibake(value) {
  const text = String(value || "");
  return /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text) || /Ã.|Â.|â€|â€™|鈥|□/.test(text);
}

function isTruncated(_standardText, actualText) {
  const actual = normalizeCompareText(actualText);
  if (!actual) return false;
  return textByteLength(actual) > state.config.truncationByteLimit;
}

function textByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function samePlaceholders(standardText, actualText) {
  const left = extractPlaceholders(standardText).sort().join("|");
  const right = extractPlaceholders(actualText).sort().join("|");
  return left === right;
}

function extractPlaceholders(value) {
  return String(value || "").match(/(%\d*\$?[sdif]|%\{[^}]+\}|\\[A-Za-z]+|\{[^{}]+\})/g) || [];
}

function hasSevereDecodeIssue(text) {
  if (!text) return true;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return replacementCount > Math.max(8, text.length * 0.02);
}

function getFilterCounts() {
  const counts = { 全部: state.results.length };
  state.results.forEach((item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    counts[item.exceptionType] = (counts[item.exceptionType] || 0) + 1;
  });
  return counts;
}

function diffHtml(standardText, actualText, side) {
  const source = side === "standard" ? String(standardText || "") : String(actualText || "");
  const other = side === "standard" ? String(actualText || "") : String(standardText || "");
  if (!source) return "";
  if (source === other) return escapeHtml(source);

  let prefix = 0;
  while (prefix < source.length && prefix < other.length && source[prefix] === other[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < source.length - prefix &&
    suffix < other.length - prefix &&
    source[source.length - 1 - suffix] === other[other.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const before = source.slice(0, prefix);
  const middle = source.slice(prefix, source.length - suffix);
  const after = source.slice(source.length - suffix);
  return `${escapeHtml(before)}${middle ? `<mark>${escapeHtml(middle)}</mark>` : ""}${escapeHtml(after)}`;
}

function suggestFix(item) {
  switch (item.exceptionType) {
    case "缺失":
      return "在PPD中补充该Key对应的本地化文本，并确认语言前缀正确。";
    case "截断":
      return `检查该文本的UTF-8字节长度是否超过 ${state.config.truncationByteLimit} 字节，必要时缩短译文或调整控件宽度。`;
    case "乱码":
      return "检查PPD编码声明、文件实际编码和导出链路，重新生成目标语言PPD。";
    case "格式异常":
      return "保持占位符、括号、转义标记与标准内容一致。";
    case "多余内容":
      return "确认该Key是否为新增需求；若是，请补充到标准库。";
    case "错误翻译":
      return "对照标准内容修正翻译，并进行回归测试。";
    default:
      return "需要测试人员结合上下文人工确认。";
  }
}

function setBusy(isBusy, label = "开始测试") {
  el.runTest.disabled = isBusy;
  el.runTest.textContent = isBusy ? label : "开始测试";
}

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function selectedPrinter() {
  return state.printers.find((printer) => printer.id === state.selectedPrinterId);
}

function normalizePrinter(printer) {
  return {
    ...printer,
    id: printer.id || printer.printer_id || printer.queueName || printer.model,
    name: printer.name || printer.printer_name || printer.model || printer.queueName || "未命名打印机",
    model: printer.model || printer.name || printer.queueName || "",
    ppdPath: printer.ppdPath || printer.ppd_path || "",
    source: printer.source || "cups"
  };
}

function printerIconHtml(printer, className, id = "") {
  const idAttr = id ? ` id="${escapeAttr(id)}"` : "";
  if (printer.iconUrl) {
    return `<img${idAttr} class="${className}" src="${escapeAttr(printer.iconUrl)}" alt="" aria-hidden="true" onerror="this.replaceWith(Object.assign(document.createElement('span'),{id:this.id,className:this.className,textContent:'${escapeAttr(printerInitials(printer))}'}))">`;
  }
  return `<span${idAttr} class="${className}" aria-hidden="true">${escapeHtml(printerInitials(printer))}</span>`;
}

function printerInitials(printer) {
  return String(printer.model || printer.name || printer.id || "PP")
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem("ppd-localization-config") || "null");
    return saved ? { ...defaultConfig, ...saved } : { ...defaultConfig };
  } catch {
    return { ...defaultConfig };
  }
}

function findHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function statusClass(status) {
  if (status === "通过") return "pass";
  if (status === "警告") return "warn";
  return "fail";
}

function stripAsterisk(value) {
  return String(value || "").replace(/^\*/, "").trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${Math.round(number * 1000) / 10}%`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatClock(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function compactDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
}

function ensureExtension(filename, extension) {
  return filename.toLowerCase().endsWith(extension) ? filename : `${filename.replace(/\.[^.]+$/, "")}${extension}`;
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  el.toastStack.append(node);
  window.setTimeout(() => node.remove(), 3200);
}

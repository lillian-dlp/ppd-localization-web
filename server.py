#!/usr/bin/env python3
import base64
import cgi
import ctypes
import ctypes.util
import difflib
import hashlib
import html
import importlib.util
import json
import mimetypes
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unicodedata
import urllib.parse
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parent
PPD_ROOT = Path("/etc/cups/ppd")
ICON_CACHE = Path(tempfile.gettempdir()) / "ppd-localization-icons"
ICON_CACHE.mkdir(parents=True, exist_ok=True)
OCR_CACHE = {}
OCR_LOCK = threading.Lock()


class CupsOption(ctypes.Structure):
    _fields_ = [("name", ctypes.c_char_p), ("value", ctypes.c_char_p)]


class CupsDest(ctypes.Structure):
    _fields_ = [
        ("name", ctypes.c_char_p),
        ("instance", ctypes.c_char_p),
        ("is_default", ctypes.c_int),
        ("num_options", ctypes.c_int),
        ("options", ctypes.POINTER(CupsOption)),
    ]


def clean_ppd_value(value):
    value = (value or "").strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if value.startswith("(") and value.endswith(")"):
        value = value[1:-1]
    return value.strip()


def parse_ppd_metadata(path):
    keys = {
        "APPrinterIconPath": "iconPath",
        "Manufacturer": "manufacturer",
        "ModelName": "model",
        "NickName": "nickName",
        "ShortNickName": "shortNickName",
        "Product": "product",
    }
    metadata = {}
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if len(metadata) >= len(keys):
                    break
                match = re.match(r"^\*([A-Za-z0-9_.-]+)\s*:\s*(.*)$", line.strip())
                if not match:
                    continue
                raw_key, raw_value = match.groups()
                if raw_key in keys and keys[raw_key] not in metadata:
                    metadata[keys[raw_key]] = clean_ppd_value(raw_value)
    except OSError:
        pass
    return metadata


def cups_destinations():
    path = ctypes.util.find_library("cups")
    if not path:
        return []

    try:
        libcups = ctypes.CDLL(path)
        libcups.cupsGetDests.argtypes = [ctypes.POINTER(ctypes.POINTER(CupsDest))]
        libcups.cupsGetDests.restype = ctypes.c_int
        libcups.cupsFreeDests.argtypes = [ctypes.c_int, ctypes.POINTER(CupsDest)]

        dests = ctypes.POINTER(CupsDest)()
        count = libcups.cupsGetDests(ctypes.byref(dests))
        printers = []
        for index in range(max(count, 0)):
            dest = dests[index]
            name = dest.name.decode("utf-8", errors="replace") if dest.name else ""
            options = {}
            for option_index in range(dest.num_options):
                option = dest.options[option_index]
                option_name = option.name.decode("utf-8", errors="replace") if option.name else ""
                option_value = option.value.decode("utf-8", errors="replace") if option.value else ""
                if option_name:
                    options[option_name] = option_value
            if name:
                printers.append(
                    {
                        "id": name,
                        "queueName": name,
                        "isDefault": bool(dest.is_default),
                        "cupsOptions": options,
                    }
                )
        if count > 0:
            libcups.cupsFreeDests(count, dests)
        return printers
    except Exception:
        return []


def ppd_path_for_queue(queue_name):
    candidates = [
        PPD_ROOT / f"{queue_name}.ppd",
        PPD_ROOT / f"{queue_name.replace(' ', '_')}.ppd",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def build_printer_record(path=None, cups_record=None):
    metadata = parse_ppd_metadata(path) if path else {}
    queue_name = cups_record.get("queueName") if cups_record else path.stem
    info = (cups_record or {}).get("cupsOptions", {})
    model = info.get("printer-make-and-model") or metadata.get("model") or metadata.get("nickName") or queue_name
    name = info.get("printer-info") or metadata.get("shortNickName") or metadata.get("nickName") or model
    manufacturer = metadata.get("manufacturer") or model.split(" ", 1)[0]
    icon_path = metadata.get("iconPath", "")
    ppd_path = str(path) if path else ""
    source = "cups" if cups_record else "ppd"

    record = {
        "id": queue_name,
        "printer_id": queue_name,
        "name": name,
        "printer_name": name,
        "model": model,
        "manufacturer": manufacturer,
        "queueName": queue_name,
        "ppdPath": ppd_path,
        "ppd_path": ppd_path,
        "iconPath": icon_path,
        "iconUrl": f"/api/printers/{urllib.parse.quote(queue_name, safe='')}/icon",
        "source": source,
        "isDefault": bool((cups_record or {}).get("isDefault")),
        "status": "已关联PPD" if path else "未找到本地PPD",
    }
    return record


def list_printers(include_orphan_ppds=False):
    records = []
    seen = set()
    for cups_record in cups_destinations():
        path = ppd_path_for_queue(cups_record["queueName"])
        if not path:
            continue
        records.append(build_printer_record(path, cups_record))
        seen.add(path.resolve())

    if include_orphan_ppds and PPD_ROOT.exists():
        for path in sorted(PPD_ROOT.glob("*.ppd")):
            if path.name.endswith(".ppd.O"):
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            records.append(build_printer_record(path))

    records.sort(key=lambda item: (not item.get("isDefault", False), item["name"].lower()))
    return records


def find_printer(printer_id):
    decoded = urllib.parse.unquote(printer_id)
    for record in list_printers(include_orphan_ppds=True):
        if record["id"] == decoded:
            return record
    return None


def fallback_svg(printer_id, label):
    initials = "".join(part[:1] for part in re.split(r"[\s_-]+", label) if part)[:2].upper() or "PP"
    palette = hashlib.sha1(label.encode("utf-8", errors="ignore")).hexdigest()
    bg = f"#{palette[:6]}"
    fg = "#ffffff"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="14" fill="{bg}"/>
  <rect x="20" y="24" width="56" height="34" rx="5" fill="{fg}" opacity=".92"/>
  <rect x="26" y="14" width="44" height="20" rx="4" fill="{fg}" opacity=".78"/>
  <rect x="28" y="56" width="40" height="22" rx="3" fill="{fg}" opacity=".68"/>
  <text x="48" y="73" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="{html.escape(bg)}">{html.escape(initials)}</text>
</svg>"""
    return svg.encode("utf-8")


def icon_png_path(source_path):
    source = Path(source_path)
    digest = hashlib.sha1(str(source).encode("utf-8")).hexdigest()
    target = ICON_CACHE / f"{digest}.png"
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    subprocess.run(
        ["sips", "-s", "format", "png", str(source), "--out", str(target)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=8,
    )
    return target


def command_exists(command):
    return shutil.which(command) is not None


def linux_capture_status():
    tools = {
        "grim": command_exists("grim"),
        "gnome-screenshot": command_exists("gnome-screenshot"),
        "import": command_exists("import"),
        "scrot": command_exists("scrot"),
        "maim": command_exists("maim"),
        "xdotool": command_exists("xdotool"),
    }
    available = any(tools[name] for name in ["grim", "gnome-screenshot", "import", "scrot", "maim"])
    return {
        "platform": sys.platform,
        "isLinux": sys.platform.startswith("linux"),
        "available": sys.platform.startswith("linux") and available,
        "sessionType": os.environ.get("XDG_SESSION_TYPE", ""),
        "display": os.environ.get("DISPLAY", ""),
        "waylandDisplay": os.environ.get("WAYLAND_DISPLAY", ""),
        "tools": tools,
        "hint": "需要 grim/gnome-screenshot/import/scrot/maim 中至少一个截图工具；窗口激活可选 xdotool。",
    }


def run_checked(command, timeout=10):
    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=timeout)


def activate_linux_window(window_title):
    if not window_title or not command_exists("xdotool"):
        return ""
    result = subprocess.run(
        ["xdotool", "search", "--name", window_title],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=5,
        check=False,
    )
    window_id = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    if window_id:
        subprocess.run(["xdotool", "windowactivate", "--sync", window_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
    return window_id


def capture_linux_screen(output_path, window_title=""):
    status = linux_capture_status()
    if not status["isLinux"]:
        raise RuntimeError("Linux自动截图仅在Linux环境可用。")
    if not status["available"]:
        raise RuntimeError(status["hint"])

    window_id = activate_linux_window(window_title)
    if window_id and command_exists("import"):
        run_checked(["import", "-window", window_id, str(output_path)])
        return {"tool": "import", "windowId": window_id}
    if command_exists("grim") and os.environ.get("WAYLAND_DISPLAY"):
        run_checked(["grim", str(output_path)])
        return {"tool": "grim", "windowId": window_id}
    if command_exists("gnome-screenshot"):
        run_checked(["gnome-screenshot", "-f", str(output_path)])
        return {"tool": "gnome-screenshot", "windowId": window_id}
    if command_exists("import"):
        run_checked(["import", "-window", "root", str(output_path)])
        return {"tool": "import", "windowId": window_id}
    if command_exists("scrot"):
        run_checked(["scrot", str(output_path)])
        return {"tool": "scrot", "windowId": window_id}
    if command_exists("maim"):
        run_checked(["maim", str(output_path)])
        return {"tool": "maim", "windowId": window_id}
    raise RuntimeError(status["hint"])


def crop_image(source_path, roi, target_path):
    from PIL import Image

    image = Image.open(source_path)
    width, height = image.size
    x = max(0, int(roi.get("x", 0)))
    y = max(0, int(roi.get("y", 0)))
    crop_width = max(1, int(roi.get("width", width)))
    crop_height = max(1, int(roi.get("height", height)))
    right = min(width, x + crop_width)
    bottom = min(height, y + crop_height)
    if x >= right or y >= bottom:
        raise ValueError("ROI超出截图范围。")
    crop = image.crop((x, y, right, bottom))
    crop.save(target_path)
    return {"x": x, "y": y, "width": right - x, "height": bottom - y}


def image_data_url(path):
    data = Path(path).read_bytes()
    return f"data:image/png;base64,{base64.b64encode(data).decode('ascii')}"


def xml_local_name(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def normalize_header(value):
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return re.sub(r"[\s_\-()（）/\\\n\r\t]+", "", text)


def language_header_tokens(language):
    language = (language or "zh_CN").lower()
    if language in {"zh_cn", "zh-hans", "zh"}:
        return {"中文", "简体中文", "简体中文zhcn", "zhcn", "zh_cn", "zhhans", "zh"}
    if language in {"zh_tw", "zh-hant"}:
        return {"繁体中文", "繁體中文", "繁体中文zhtw", "繁體中文zhtw", "zhtw", "zh_tw", "zhhant"}
    if language.startswith("en"):
        return {"英语", "英文", "英语en", "英語en", "english", "en", "enus", "en_us"}
    if language.startswith("ru"):
        return {"俄语", "俄語", "russian", "ru"}
    if language.startswith("de"):
        return {"德语", "德語", "german", "de"}
    if language.startswith("it"):
        return {"意大利语", "意大利語", "italian", "it"}
    if language.startswith("fr"):
        return {"法语", "法語", "french", "fr"}
    if language.startswith("es"):
        return {"西班牙语", "西班牙語", "spanish", "es"}
    if language.startswith("pt"):
        return {"葡萄牙语", "葡萄牙語", "portuguese", "pt", "ptbr"}
    if language.startswith("ja"):
        return {"日语", "日語", "japanese", "ja"}
    if language.startswith("ko"):
        return {"韩语", "韓語", "korean", "ko"}
    return {language.replace("_", "")}


def excel_column_index(cell_ref):
    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return 0
    index = 0
    for char in match.group(1):
        index = index * 26 + ord(char) - ord("A") + 1
    return index - 1


def read_xlsx_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    strings = []
    for si in root:
        if xml_local_name(si.tag) != "si":
            continue
        parts = [node.text or "" for node in si.iter() if xml_local_name(node.tag) == "t"]
        strings.append("".join(parts))
    return strings


def read_xlsx_sheet_paths(archive):
    names = archive.namelist()
    if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        return [(Path(name).stem, name) for name in sorted(names) if name.startswith("xl/worksheets/") and name.endswith(".xml")]

    rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rels = {}
    for rel in rel_root:
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target", "")
        if rel_id and target:
            target = target.lstrip("/")
            rels[rel_id] = target if target.startswith("xl/") else "xl/" + target

    workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    sheets = []
    rel_key = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for node in workbook_root.iter():
        if xml_local_name(node.tag) != "sheet":
            continue
        sheet_name = node.attrib.get("name", "Sheet")
        rel_id = node.attrib.get(rel_key) or node.attrib.get("r:id")
        path = rels.get(rel_id)
        if path and path in names:
            sheets.append((sheet_name, path))
    return sheets


def read_xlsx_sheet_rows(archive, sheet_path, shared_strings):
    root = ET.fromstring(archive.read(sheet_path))
    rows = []
    for row_node in root.iter():
        if xml_local_name(row_node.tag) != "row":
            continue
        row = []
        for cell in row_node:
            if xml_local_name(cell.tag) != "c":
                continue
            col_index = excel_column_index(cell.attrib.get("r", ""))
            while len(row) <= col_index:
                row.append("")
            cell_type = cell.attrib.get("t", "")
            value = ""
            if cell_type == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter() if xml_local_name(node.tag) == "t")
            else:
                value_node = next((node for node in cell if xml_local_name(node.tag) == "v"), None)
                if value_node is not None and value_node.text is not None:
                    raw = value_node.text
                    if cell_type == "s":
                        try:
                            value = shared_strings[int(raw)]
                        except (ValueError, IndexError):
                            value = raw
                    else:
                        value = raw
            row[col_index] = value
        if any(str(cell).strip() for cell in row):
            rows.append(row)
    return rows


def parse_xlsx_standard(path, language):
    key_headers = {"ppdkey", "ppd键", "ppd关键字", "key", "standardkey", "标准标识"}
    text_headers = {normalize_header(token) for token in language_header_tokens(language)}
    skip_sheet_tokens = ("报告", "统计", "说明", "履历", "history", "report", "summary", "readme")
    items = []

    with zipfile.ZipFile(path) as archive:
        shared_strings = read_xlsx_shared_strings(archive)
        for sheet_name, sheet_path in read_xlsx_sheet_paths(archive):
            if any(token in sheet_name.lower() for token in skip_sheet_tokens):
                continue
            rows = read_xlsx_sheet_rows(archive, sheet_path, shared_strings)
            header_index = key_col = text_col = None
            for index, row in enumerate(rows[:30]):
                normalized = [normalize_header(cell) for cell in row]
                key_candidates = [i for i, header in enumerate(normalized) if header in key_headers]
                text_candidates = [i for i, header in enumerate(normalized) if header in text_headers]
                if key_candidates and text_candidates:
                    header_index = index
                    key_col = key_candidates[0]
                    text_col = text_candidates[0]
                    break
            if header_index is None:
                continue

            for row_offset, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
                key = row[key_col].strip() if key_col < len(row) else ""
                value = row[text_col].strip() if text_col < len(row) else ""
                if not key or not value:
                    continue
                items.append(
                    {
                        "key": key,
                        "standard_text": value,
                        "sheet": sheet_name,
                        "row": row_offset,
                    }
                )
    return items


def paddleocr_available():
    return importlib.util.find_spec("paddleocr") is not None


def rapidocr_available():
    return importlib.util.find_spec("rapidocr") is not None


def available_ocr_engines():
    engines = []
    if rapidocr_available():
        engines.append("RapidOCR")
    if paddleocr_available():
        engines.append("PaddleOCR")
    return engines


def normalize_ocr_text(value):
    value = unicodedata.normalize("NFKC", value or "")
    return re.sub(r"\s+", "", value).lower()


def map_paddle_lang(language):
    mapping = {
        "zh_CN": "ch",
        "zh_TW": "ch",
        "ja": "japan",
        "ko": "korean",
        "fr": "fr",
        "de": "german",
        "es": "es",
        "it": "it",
        "pt_BR": "pt",
        "ru": "ru",
        "en": "en",
    }
    return mapping.get(language, language or "ch")


def get_paddle_ocr(language):
    lang = map_paddle_lang(language)
    if lang in OCR_CACHE:
        return OCR_CACHE[lang]

    from paddleocr import PaddleOCR

    try:
        ocr = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    except TypeError:
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
    OCR_CACHE[lang] = ocr
    return ocr


def get_rapid_ocr(language):
    key = f"rapid:{map_paddle_lang(language)}"
    if key in OCR_CACHE:
        return OCR_CACHE[key]

    from rapidocr import RapidOCR

    ocr = RapidOCR()
    OCR_CACHE[key] = ocr
    return ocr


def image_size(path):
    data = Path(path).read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return width, height
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in (0xD8, 0xD9):
                continue
            length = struct.unpack(">H", data[index : index + 2])[0]
            if marker in range(0xC0, 0xC4):
                height, width = struct.unpack(">HH", data[index + 3 : index + 7])
                return width, height
            index += length
    return 0, 0


def is_poly(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) == 4
        and all(isinstance(point, (list, tuple)) and len(point) >= 2 for point in value)
    )


def normalize_box(box):
    if box is None:
        return [0, 0, 0, 0]
    if is_poly(box):
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        return [min(xs), min(ys), max(xs), max(ys)]
    if isinstance(box, (list, tuple)) and len(box) >= 4:
        return [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
    return [0, 0, 0, 0]


def jsonable(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def result_payload(result):
    if isinstance(result, dict):
        return jsonable(result)
    if hasattr(result, "json"):
        data = result.json
        if callable(data):
            data = data()
        return jsonable(data)
    if hasattr(result, "__dict__"):
        return jsonable(result.__dict__)
    return jsonable(result)


def extract_v3_detections(result):
    detections = []
    for page in result if isinstance(result, list) else [result]:
        payload = result_payload(page)
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts") or payload.get("text") or []
        scores = payload.get("rec_scores") or payload.get("scores") or []
        boxes = payload.get("rec_boxes") or payload.get("rec_polys") or payload.get("dt_polys") or []
        for index, text in enumerate(texts):
            score = scores[index] if index < len(scores) else 0
            box = boxes[index] if index < len(boxes) else None
            detections.append({"text": str(text), "score": float(score or 0), "box": normalize_box(box)})
    return detections


def extract_v2_detections(result):
    detections = []

    def visit(node):
        if not isinstance(node, (list, tuple)):
            return
        if len(node) == 2 and is_poly(node[0]) and isinstance(node[1], (list, tuple)) and len(node[1]) >= 2:
            detections.append({"text": str(node[1][0]), "score": float(node[1][1] or 0), "box": normalize_box(node[0])})
            return
        for item in node:
            visit(item)

    visit(result)
    return detections


def run_paddle_ocr(image_path, language):
    ocr = get_paddle_ocr(language)
    if hasattr(ocr, "predict"):
        result = ocr.predict(str(image_path))
        detections = extract_v3_detections(result)
    else:
        result = ocr.ocr(str(image_path), cls=True)
        detections = extract_v2_detections(result)
    detections.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return detections


def extract_rapid_detections(result):
    detections = []
    json_result = None
    if hasattr(result, "to_json"):
        try:
            json_result = result.to_json()
        except Exception:
            json_result = None

    if isinstance(json_result, str):
        try:
            json_result = json.loads(json_result)
        except json.JSONDecodeError:
            json_result = None

    if isinstance(json_result, dict):
        json_result = json_result.get("data") or json_result.get("result") or json_result.get("ocr_result")

    if isinstance(json_result, list):
        for item in json_result:
            if not isinstance(item, dict):
                continue
            text = item.get("txt") or item.get("text") or item.get("rec_text") or ""
            score = item.get("score") or item.get("confidence") or item.get("rec_score") or 0
            box = item.get("box") or item.get("points") or item.get("bbox")
            detections.append({"text": str(text), "score": float(score or 0), "box": normalize_box(box)})

    if detections:
        return detections

    boxes = getattr(result, "boxes", None) or []
    texts = getattr(result, "txts", None) or []
    scores = getattr(result, "scores", None) or []
    for index, text in enumerate(texts):
        score = scores[index] if index < len(scores) else 0
        box = boxes[index] if index < len(boxes) else None
        detections.append({"text": str(text), "score": float(score or 0), "box": normalize_box(jsonable(box))})
    return detections


def run_rapid_ocr(image_path, language):
    with OCR_LOCK:
        ocr = get_rapid_ocr(language)
        result = ocr(str(image_path))
    detections = extract_rapid_detections(result)
    detections.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return detections


def run_ocr(image_path, language):
    if rapidocr_available():
        return "RapidOCR", "default", run_rapid_ocr(image_path, language)
    if paddleocr_available():
        return "PaddleOCR", map_paddle_lang(language), run_paddle_ocr(image_path, language)
    raise RuntimeError("未安装OCR引擎，请安装 RapidOCR：pip install rapidocr onnxruntime")


def judge_truncation(expected_text, detections, width):
    recognized = "".join(item["text"] for item in detections).strip()
    expected_norm = normalize_ocr_text(expected_text)
    recognized_norm = normalize_ocr_text(recognized)
    recognized_without_tail_dots = normalize_ocr_text(re.sub(r"[\.\u2026\u22ef\uff0e\u3002]+$", "", recognized))
    scores = [item["score"] for item in detections if item["score"]]
    avg_score = sum(scores) / len(scores) if scores else 0
    right_edge = max((item["box"][2] for item in detections), default=0)
    right_margin = max(0, width - right_edge) if width else None
    edge_threshold = max(4, width * 0.03) if width else 0
    touches_right_edge = bool(width and right_margin is not None and right_margin <= edge_threshold)
    has_ellipsis = bool(re.search(r"(\.\.\.|[\.\u2026\u22ef\uff0e\u3002]+)$", recognized))
    similarity = difflib.SequenceMatcher(None, expected_norm, recognized_norm).ratio() if expected_norm or recognized_norm else 0
    is_prefix = bool(recognized_norm and expected_norm.startswith(recognized_norm) and recognized_norm != expected_norm)
    is_prefix_after_dots = bool(
        recognized_without_tail_dots
        and expected_norm.startswith(recognized_without_tail_dots)
        and recognized_without_tail_dots != expected_norm
    )

    if not recognized_norm:
        verdict = "no_text"
        message = "未识别到文字，需检查截图区域或OCR模型。"
    elif avg_score and avg_score < 0.55:
        verdict = "low_confidence"
        message = "OCR置信度较低，建议重新截图或人工确认。"
    elif expected_norm and (expected_norm == recognized_norm or expected_norm in recognized_norm):
        verdict = "pass"
        message = "OCR文本包含完整期望字符串，未发现截断。"
    elif (has_ellipsis and is_prefix_after_dots) or (is_prefix and touches_right_edge):
        verdict = "truncated"
        message = "识别文本疑似为期望字符串前缀，且贴近控件右边界或出现省略号。"
    elif is_prefix or is_prefix_after_dots:
        verdict = "suspected_truncated"
        message = "识别文本是期望字符串前缀，但未贴近右边界，建议复核控件宽度。"
    elif touches_right_edge and expected_norm and len(recognized_norm) < len(expected_norm):
        verdict = "suspected_truncated"
        message = "识别文本短于期望字符串且贴近右边界，疑似截断。"
    elif similarity < 0.5:
        verdict = "mismatch"
        message = "OCR文本与期望字符串差异较大，可能是错误区域或翻译不一致。"
    else:
        verdict = "needs_review"
        message = "OCR结果无法稳定判定，建议人工确认。"

    return {
        "verdict": verdict,
        "message": message,
        "recognizedText": recognized,
        "averageScore": avg_score,
        "similarity": similarity,
        "touchesRightEdge": touches_right_edge,
        "rightMargin": right_margin,
        "hasEllipsis": has_ellipsis,
        "isPrefix": is_prefix,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/ocr/status":
            engines = available_ocr_engines()
            self.send_json(
                {
                    "available": bool(engines),
                    "engine": engines[0] if engines else "",
                    "engines": engines,
                    "preferred": "RapidOCR",
                    "installHint": "" if engines else "pip install rapidocr onnxruntime",
                }
            )
            return

        if path == "/api/capture/linux/status":
            self.send_json(linux_capture_status())
            return

        if path == "/api/printers":
            query = urllib.parse.parse_qs(parsed.query)
            include_orphan_ppds = query.get("include_orphan_ppds", ["0"])[0] in {"1", "true", "yes"}
            self.send_json(
                {
                    "printers": list_printers(include_orphan_ppds=include_orphan_ppds),
                    "ppdRoot": str(PPD_ROOT),
                    "includeOrphanPpds": include_orphan_ppds,
                }
            )
            return

        ppd_match = re.match(r"^/api/printers/([^/]+)/ppd$", path)
        if ppd_match:
            record = find_printer(ppd_match.group(1))
            if not record:
                self.send_json({"error": "printer_not_found"}, 404)
                return
            if not record.get("ppdPath"):
                self.send_json({"error": "ppd_not_found", "message": "未找到该打印机对应的本地PPD。"}, 404)
                return
            ppd_path = Path(record["ppdPath"])
            try:
                text = ppd_path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                self.send_json({"error": str(exc)}, 500)
                return
            self.send_json({"printer": record, "ppdText": text, "fileName": ppd_path.name, "size": ppd_path.stat().st_size})
            return

        icon_match = re.match(r"^/api/printers/([^/]+)/icon$", path)
        if icon_match:
            record = find_printer(icon_match.group(1))
            if not record:
                self.send_bytes(fallback_svg("", "PPD"), "image/svg+xml", 404)
                return
            icon_path = record.get("iconPath") or ""
            if icon_path and Path(icon_path).exists():
                try:
                    png = icon_png_path(icon_path)
                    self.send_bytes(png.read_bytes(), "image/png")
                    return
                except Exception:
                    pass
            self.send_bytes(fallback_svg(record["id"], record["name"]), "image/svg+xml")
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/standard/parse":
            self.handle_standard_parse()
            return

        if parsed.path == "/api/capture/linux/ocr":
            self.handle_linux_capture_ocr()
            return

        if parsed.path != "/api/ocr/truncation":
            self.send_json({"error": "not_found"}, 404)
            return

        if not available_ocr_engines():
            self.send_json(
                {
                    "error": "ocr_not_installed",
                    "message": "当前Python环境未安装可用OCR引擎。",
                    "installHint": "pip install rapidocr onnxruntime",
                },
                503,
            )
            return

        content_type = self.headers.get("content-type", "")
        if "multipart/form-data" not in content_type:
            self.send_json({"error": "multipart_required"}, 400)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("content-length", "0"),
            },
        )
        expected_text = form.getfirst("expected_text", "")
        language = form.getfirst("language", "zh_CN")
        image_field = form["image"] if "image" in form else None
        if not expected_text.strip():
            self.send_json({"error": "expected_text_required"}, 400)
            return
        if image_field is None or not getattr(image_field, "file", None):
            self.send_json({"error": "image_required"}, 400)
            return

        suffix = Path(image_field.filename or "ocr.png").suffix or ".png"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = Path(tmp.name)
                tmp.write(image_field.file.read())

            width, height = image_size(tmp_path)
            engine_name, engine_language, detections = run_ocr(tmp_path, language)
            judgment = judge_truncation(expected_text, detections, width)
            self.send_json(
                {
                    "engine": engine_name,
                    "language": engine_language,
                    "image": {"width": width, "height": height},
                    "expectedText": expected_text,
                    "detections": detections,
                    **judgment,
                }
            )
        except Exception as exc:
            self.send_json({"error": "ocr_failed", "message": str(exc)}, 500)
        finally:
            if tmp_path:
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def handle_standard_parse(self):
        content_type = self.headers.get("content-type", "")
        if "multipart/form-data" not in content_type:
            self.send_json({"error": "multipart_required"}, 400)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("content-length", "0"),
            },
        )
        standard_field = form["standard"] if "standard" in form else None
        language = form.getfirst("language", "zh_CN")
        if standard_field is None or not getattr(standard_field, "file", None):
            self.send_json({"error": "standard_required", "message": "需要上传Excel标准库文件。"}, 400)
            return

        suffix = Path(standard_field.filename or "standard.xlsx").suffix.lower()
        if suffix not in {".xlsx", ".xlsm"}:
            self.send_json({"error": "unsupported_excel", "message": "当前支持 .xlsx / .xlsm 标准库。"}, 400)
            return

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = Path(tmp.name)
                tmp.write(standard_field.file.read())
            items = parse_xlsx_standard(tmp_path, language)
            if not items:
                self.send_json(
                    {
                        "error": "no_standard_items",
                        "message": "Excel中未找到可用的PPD Key列和当前语言标准文本列。",
                    },
                    400,
                )
                return
            self.send_json({"items": items, "count": len(items), "language": language})
        except zipfile.BadZipFile:
            self.send_json({"error": "bad_xlsx", "message": "Excel文件格式不正确，请使用 .xlsx / .xlsm。"}, 400)
        except Exception as exc:
            self.send_json({"error": "standard_parse_failed", "message": str(exc)}, 500)
        finally:
            if tmp_path:
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def read_json_body(self):
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def handle_linux_capture_ocr(self):
        if not available_ocr_engines():
            self.send_json(
                {
                    "error": "ocr_not_installed",
                    "message": "当前Python环境未安装可用OCR引擎。",
                    "installHint": "pip install rapidocr onnxruntime",
                },
                503,
            )
            return

        payload = self.read_json_body()
        expected_text = str(payload.get("expected_text", "")).strip()
        language = payload.get("language", "zh_CN")
        roi = payload.get("roi") or {}
        window_title = str(payload.get("window_title", "")).strip()
        if not expected_text:
            self.send_json({"error": "expected_text_required"}, 400)
            return
        for key in ["x", "y", "width", "height"]:
            if key not in roi:
                self.send_json({"error": "roi_required", "message": "需要提供 x/y/width/height。"}, 400)
                return

        screenshot_path = None
        crop_path = None
        try:
            screenshot_file = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            screenshot_path = Path(screenshot_file.name)
            screenshot_file.close()
            crop_file = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            crop_path = Path(crop_file.name)
            crop_file.close()

            capture_info = capture_linux_screen(screenshot_path, window_title)
            actual_roi = crop_image(screenshot_path, roi, crop_path)
            width, height = image_size(crop_path)
            engine_name, engine_language, detections = run_ocr(crop_path, language)
            judgment = judge_truncation(expected_text, detections, width)
            self.send_json(
                {
                    "engine": engine_name,
                    "language": engine_language,
                    "capture": capture_info,
                    "roi": actual_roi,
                    "image": {"width": width, "height": height},
                    "expectedText": expected_text,
                    "detections": detections,
                    "cropDataUrl": image_data_url(crop_path),
                    **judgment,
                }
            )
        except Exception as exc:
            self.send_json({"error": "linux_capture_failed", "message": str(exc), "status": linux_capture_status()}, 500)
        finally:
            for path in [screenshot_path, crop_path]:
                if path:
                    try:
                        path.unlink()
                    except OSError:
                        pass


def main():
    port = int(os.environ.get("PPD_WEB_PORT", "4173"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"PPD localization web server: http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

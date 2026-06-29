#!/usr/bin/env python3
"""提取 PPD 中某语言 *<lang>.Translation 行的选项标签译文。

用法:
    python3 extract_translation.py <file.ppd> [lang]

不带 lang 时列出该 PPD 内出现的所有语言；带 lang 时打印该语言
每个选项标签的译文 (key -> 译文)。
"""
import re
import sys

# *zh_CN.Translation PageSize/纸张尺寸: ""
RE_TR = re.compile(r'^\*([A-Za-z]{2}(?:_[A-Za-z]{2})?)\.Translation\s+([\w.]+)/(.*?):')
RE_HEX = re.compile(r'<([0-9a-fA-F ]+)>')


def unesc(s: str) -> str:
    """解码 PPD 的 <HEXHEX> (UTF-8 字节) 转义并去除首尾引号/空白。"""
    def repl(m):
        b = bytes.fromhex(m.group(1).replace(' ', ''))
        try:
            return b.decode('utf-8')
        except UnicodeDecodeError:
            return m.group(0)
    s = RE_HEX.sub(repl, s)
    return s.strip().strip('"').strip()


def extract(text: str):
    """返回 {lang: {key: 译文}}。"""
    out: dict[str, dict[str, str]] = {}
    for raw in text.splitlines():
        m = RE_TR.match(raw.strip())
        if m:
            lang, key, txt = m.group(1), m.group(2), m.group(3)
            out.setdefault(lang, {})[key] = unesc(txt)
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    with open(argv[1], encoding='utf-8', errors='replace') as f:
        data = extract(f.read())
    if len(argv) < 3:
        print('该 PPD 出现的语言:', ', '.join(sorted(data)) or '(无)')
        return 0
    lang = argv[2]
    items = data.get(lang)
    if not items:
        print(f'未找到语言 {lang} 的 .Translation 行')
        return 0
    print(f'# {lang} .Translation 标签译文 ({len(items)} 项)')
    for key, txt in items.items():
        print(f'{key}\t{txt}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

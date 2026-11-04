"""重新產生 i18n.js 裡的簡繁對照表（TRAD / SIMP 兩串）。

club 的介面字加了新的繁體字、而那個字的簡體寫法不一樣時，跑一次：

    pip install opencc-python-reimplemented
    python tools/build_i18n.py

只會改 i18n.js 裡 `const TRAD = ...;` 和 `const SIMP = ...;` 這兩行。
大包子那邊回傳的錯誤訊息也會顯示在 club 上，有它的 repo 就一起掃（找不到就跳過）。
"""
import json
import pathlib
import re

import opencc

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = [ROOT / "index.js", ROOT / "bot.js", ROOT / "shots.js", ROOT / "desktop.js", ROOT / "templates.js", ROOT / "aidesign.js", ROOT / "xiaobaozi.js", ROOT / "htmlcard.js", ROOT / "report.js", ROOT / "version.js", ROOT / "inbox.js", ROOT / "game.js", ROOT / "changelog.json",
           ROOT.parent / "BIG-baozi" / "club" / "api.py",
           ROOT.parent / "BIG-baozi" / "club" / "chat.py",
           ROOT.parent / "BIG-baozi" / "club" / "shots.py",
           ROOT.parent / "BIG-baozi" / "club" / "desktop.py",
           ROOT.parent / "BIG-baozi" / "routine" / "weather.py",
           ROOT.parent / "BIG-baozi" / "lunar.py"]

cc = opencc.OpenCC("t2s")
text = "".join(p.read_text(encoding="utf-8") for p in SOURCES if p.exists())
chars = sorted({ch for ch in text if "一" <= ch <= "鿿"})
pairs = [(c, cc.convert(c)) for c in chars]
pairs = [(a, b) for a, b in pairs if a != b and len(b) == 1]
trad = "".join(a for a, _ in pairs)
simp = "".join(b for _, b in pairs)

target = ROOT / "i18n.js"
js = target.read_text(encoding="utf-8")
js = re.sub(r"const TRAD = .*;", "const TRAD = " + json.dumps(trad, ensure_ascii=False) + ";", js)
js = re.sub(r"const SIMP = .*;", "const SIMP = " + json.dumps(simp, ensure_ascii=False) + ";", js)
target.write_text(js, encoding="utf-8")
print(f"{len(pairs)} 個字有簡繁差異，已更新 i18n.js")

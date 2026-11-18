# 產生使用台灣標準中文字型（MSung-Light，Adobe-CNS1 字型集、UniCNS-UCS2-H 編碼、不內嵌字型、無 ToUnicode）之 PDF，
# 驗證 App 內建之繁體中文字元對照表（CMap）。中文以 CID 字型輸出，數字以 Helvetica 輸出（常見於會計軟體）。
import json, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import CIDFont

rows = json.load(open(sys.argv[1], encoding='utf-8'))['BS_ROWS']
CJK = 'MSung-Light-UniCNS-UCS2-H'
pdfmetrics.registerFont(CIDFont('MSung-Light', 'UniCNS-UCS2-H'))
c = canvas.Canvas(sys.argv[2], pagesize=A4)
W, H = A4
y = H - 50
cols = [40, 80, 250]           # 代碼、科目、附註（靠左）
rights = [380, 410, 500, 530]  # 金額、%、金額、%（靠右）

def cjk(x, y, s):
    c.setFont(CJK, 9)
    # UniCNS-UCS2-H：每字以 UCS-2（大端序）兩位元組表示
    c.drawString(x, y, s.encode('utf-16-be').decode('latin-1'))

for r in rows:
    for i, v in enumerate(r):
        if not v: continue
        ascii_only = all(ord(ch) < 128 for ch in v)
        if i < 3:
            if ascii_only: c.setFont('Helvetica', 9); c.drawString(cols[i], y, v)
            else: cjk(cols[i], y, v)
        elif ascii_only:
            c.setFont('Helvetica', 9); c.drawRightString(rights[i - 3], y, v)
        else:
            cjk(rights[i - 3] - 9 * len(v), y, v)  # 中文表頭：以每字 9pt 估算寬度後靠右
    y -= 14
c.save()

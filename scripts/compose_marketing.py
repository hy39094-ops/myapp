"""
myapp(전국 스포츠토토 판매점 찾기) 실제 화면 → 1080x1920 마케팅 스크린샷.
폰 mockup + 상단 캡션. 정보성(베팅 기능 없음) 톤.
"""
from __future__ import annotations
import os
from dataclasses import dataclass
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets-store", "screenshots-real")
OUT = os.path.join(ROOT, "assets-store", "screenshots")
os.makedirs(OUT, exist_ok=True)

FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
W_REG, W_MED, W_SB, W_BOLD, W_HEAVY = 3, 4, 5, 6, 7

BLUE_TOP = (37, 99, 235)
BLUE_BOT = (13, 30, 75)
ACCENT = (90, 220, 180)   # 청록 포인트 (지도/위치 느낌)
WHITE = (255, 255, 255)
SUB = (210, 222, 245)
PHONE_BG = (245, 247, 252)
DARK = (24, 33, 55)


def font(sz, w=W_MED):
    return ImageFont.truetype(FONT, size=sz, index=w)

def grad(w, h):
    col = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        col.putpixel((0, y), tuple(int(BLUE_TOP[i]*(1-t)+BLUE_BOT[i]*t) for i in range(3)))
    return col.resize((w, h))

def blobs(img):
    w, h = img.size
    ov = Image.new("RGBA", (w, h), (0,0,0,0)); od = ImageDraw.Draw(ov)
    for cx, cy, r, c in [(-int(w*.18),-int(h*.08),int(w*.55),(110,160,245,90)),
                         (int(w*.62),int(h*.82),int(w*.6),(40,80,170,90)),
                         (int(w*.8),int(h*.05),int(w*.3),(90,220,180,40))]:
        od.ellipse([cx-r,cy-r,cx+r,cy+r], fill=c)
    img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(80)))

@dataclass
class Slide:
    src: str; headline: list; sub: str; out: str

SLIDES = [
    Slide("01_map.png", ["전국 스포츠토토 판매점,", "지도에서 한눈에"],
          "전국 6,300여 개 판매점 위치 정보", "phone-01_map.png"),
    Slide("02_list.png", ["내 주변 판매점을", "가까운 순으로"],
          "거리·이름순 정렬, 반경 필터까지", "phone-02_list.png"),
    Slide("03_detail.png", ["선택하면 바로", "길찾기 연결"],
          "티맵·네이버지도·카카오맵으로 안내", "phone-03_detail.png"),
    Slide("04_search.png", ["판매점 이름·지역으로", "빠르게 검색"],
          "원하는 동네 판매점을 바로 찾아요", "phone-04_search.png"),
]

def make_phone(cw, ch, cap):
    pw = int(cw*0.74); ph = int(pw*2.05)
    mh = int(ch*0.70)
    if ph > mh: ph = mh; pw = int(ph/2.05)
    bz = max(10, int(pw*0.025)); iw = pw-bz*2; ih = ph-bz*2
    cwd, chd = cap.size; sc = iw/cwd
    sca = cap.resize((iw, int(chd*sc)), Image.LANCZOS)
    disp = Image.new("RGB", (iw, ih), PHONE_BG)
    if sca.height > ih: disp.paste(sca.crop((0,0,iw,ih)), (0,0))
    else: disp.paste(sca, (0, (ih-sca.height)//2))
    mask = Image.new("L", disp.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,iw,ih], radius=int(iw*0.075), fill=255)
    phone = Image.new("RGBA", (pw, ph), (0,0,0,0))
    ImageDraw.Draw(phone).rounded_rectangle([0,0,pw,ph], radius=int(pw*0.1), fill=DARK+(255,))
    d = disp.convert("RGBA"); d.putalpha(mask); phone.paste(d, (bz,bz), d)
    return phone

def caption(draw, w, top, head, sub):
    hs = int(w*0.078); fh = font(hs, W_HEAVY); fs = font(int(w*0.034), W_MED)
    cy = top
    for ln in head:
        bb = draw.textbbox((0,0), ln, font=fh); lw = bb[2]-bb[0]
        draw.text((int((w-lw)/2-bb[0]), cy-bb[1]), ln, font=fh, fill=WHITE)
        cy += bb[3]-bb[1]+int(hs*0.18)
    lw2 = int(w*0.18); lh = int(w*0.0045)+1; cy += int(hs*0.05)
    draw.rounded_rectangle([(w-lw2)//2, cy, (w+lw2)//2, cy+lh], radius=lh//2, fill=ACCENT)
    cy += lh+int(hs*0.4)
    bb = draw.textbbox((0,0), sub, font=fs); sw = bb[2]-bb[0]
    draw.text((int((w-sw)/2-bb[0]), cy-bb[1]), sub, font=fs, fill=SUB)
    return cy+(bb[3]-bb[1])

def render(s, w, h):
    cap = Image.open(os.path.join(SRC, s.src)).convert("RGB")
    img = grad(w, h).convert("RGBA"); blobs(img); draw = ImageDraw.Draw(img)
    cb = caption(draw, w, int(h*0.06), s.headline, s.sub)
    phone = make_phone(w, h, cap); px = (w-phone.width)//2
    at = cb+int(h*0.025); ab = h-int(h*0.06)
    py = max(at, at+((ab-at)-phone.height)//2)
    sh = Image.new("RGBA", (phone.width+80, phone.height+80), (0,0,0,0))
    ImageDraw.Draw(sh).rounded_rectangle([40,50,40+phone.width,50+phone.height], radius=int(phone.width*0.1), fill=(0,0,0,130))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(24)), (px-40, py-40))
    img.alpha_composite(phone, (px, py))
    fw = font(int(w*0.022), W_SB); wm = "전국 스포츠토토 판매점 찾기"
    bb = draw.textbbox((0,0), wm, font=fw); ww = bb[2]-bb[0]
    draw.text((int((w-ww)/2-bb[0]), h-int(h*0.04)), wm, font=fw, fill=(195,210,240))
    img.convert("RGB").save(os.path.join(OUT, s.out), "PNG", optimize=True)
    print("saved:", s.out)

if __name__ == "__main__":
    for s in SLIDES:
        render(s, 1080, 1920)

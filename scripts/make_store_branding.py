"""
myapp 스토어 아이콘(512) + 그래픽(1024x500).
아이콘: 기존 브랜딩 로고 재사용. 그래픽: 같은 블루 톤 + 위치 핀.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets-store")
os.makedirs(OUT, exist_ok=True)
LOGO = os.path.join(ROOT, "www", "branding", "logo.png")
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

BLUE_TOP = (51, 130, 246)   # 로고 톤
BLUE_BOT = (29, 78, 200)
WHITE = (255, 255, 255)
SUB = (215, 230, 255)


def font(sz, w=4):
    return ImageFont.truetype(FONT, size=sz, index=w)


def center_text(d, cx, cy, text, fnt, fill):
    bb = d.textbbox((0, 0), text, font=fnt)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.text((cx - w / 2 - bb[0], cy - h / 2 - bb[1]), text, font=fnt, fill=fill)


def make_icon():
    S = 512
    img = grad(S, S).convert("RGBA")
    # 은은한 광원
    ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    od.ellipse([-120, -150, 320, 290], fill=(120, 170, 255, 80))
    img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(60)))
    d = ImageDraw.Draw(img)
    # 위치 핀 (상단 중앙) — 작게, 위로
    pin(d, S // 2, int(S * 0.28), int(S * 0.115), WHITE)
    # "내 주변" (대형 강조)
    center_text(d, S // 2, int(S * 0.62), "내 주변", font(int(S * 0.18), 7), WHITE)
    # "스포츠토토" (보조)
    center_text(d, S // 2, int(S * 0.78), "스포츠토토", font(int(S * 0.095), 6), (205, 225, 255))
    img.convert("RGB").save(os.path.join(OUT, "icon-512.png"), "PNG", optimize=True)
    print("saved: icon-512.png (512x512, '내 주변' 텍스트)")


def grad(w, h):
    col = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        col.putpixel((0, y), tuple(int(BLUE_TOP[i]*(1-t)+BLUE_BOT[i]*t) for i in range(3)))
    return col.resize((w, h))


def pin(draw, cx, cy, r, fill):
    # 위치 핀: 원 + 아래 꼭지점
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=fill)
    draw.polygon([(cx-r*0.62, cy+r*0.5), (cx+r*0.62, cy+r*0.5), (cx, cy+r*1.7)], fill=fill)
    # 가운데 도넛
    ir = r*0.42
    draw.ellipse([cx-ir, cy-ir, cx+ir, cy+ir], fill=BLUE_BOT)
    cr = r*0.16
    draw.ellipse([cx-cr, cy-cr, cx+cr, cy+cr], fill=fill)


def make_feature():
    W, H = 1024, 500
    img = grad(W, H).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0,0,0,0)); od = ImageDraw.Draw(ov)
    od.ellipse([-160,-180,360,320], fill=(120,170,255,70))
    od.ellipse([W-300,H-180,W+160,H+220], fill=(20,60,160,80))
    img.alpha_composite(ov.filter(ImageFilter.GaussianBlur(70)))
    d = ImageDraw.Draw(img)
    left = 70
    # 태그
    tag = "전국 6,300여 개 판매점"; ft = font(int(W*0.028), 6)
    bb = d.textbbox((0,0), tag, font=ft); tw = bb[2]-bb[0]
    d.rounded_rectangle([left, 92, left+tw+44, 92+(bb[3]-bb[1])+20], radius=22, fill=(255,255,255,240))
    d.text((left+22-bb[0], 102-bb[1]), tag, font=ft, fill=(29,78,200))
    # 타이틀
    ft2 = font(int(W*0.072), 7)
    d.text((left, 162), "스포츠토토 판매점", font=ft2, fill=WHITE)
    d.text((left, 252), "위치 찾기", font=ft2, fill=WHITE)
    # 부제
    fs = font(int(W*0.032), 4)
    d.text((left, 372), "내 주변 판매점을 지도에서 · 길찾기까지 한 번에", font=fs, fill=SUB)
    # 오른쪽 핀
    pin(d, W-180, H//2-20, 78, WHITE)
    img.convert("RGB").save(os.path.join(OUT, "feature-graphic-1024x500.png"), "PNG", optimize=True)
    print("saved: feature-graphic-1024x500.png (1024x500)")


if __name__ == "__main__":
    make_icon()
    make_feature()

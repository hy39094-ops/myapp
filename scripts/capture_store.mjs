// myapp(스포츠토토 판매점 찾기) 실제 화면 캡쳐 → assets-store/screenshots-real/
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "assets-store", "screenshots-real");
mkdirSync(OUT, { recursive: true });

const URL = process.env.URL || "http://localhost:5173/";
const VP = { width: 440, height: 950, deviceScaleFactor: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMap(page) {
  // 네이버 지도 타일이 로드될 시간
  await sleep(2500);
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, name), type: "png" });
  console.log("saved:", name);
}
async function clickByTextOrAria(page, { text, aria }) {
  const ok = await page.evaluate((text, aria) => {
    const els = Array.from(document.querySelectorAll('button, [role="button"], a, li, [class*="item"], [class*="row"]'));
    const el = els.find((e) => {
      const t = (e.textContent || "").replace(/\s+/g, " ").trim();
      const a = e.getAttribute("aria-label") || "";
      return (text && t.includes(text)) || (aria && a.includes(aria));
    });
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
    return false;
  }, text || "", aria || "");
  return ok;
}

const browser = await puppeteer.launch({ headless: "new", defaultViewport: VP, args: ["--no-sandbox", "--lang=ko-KR"] });
const page = await browser.newPage();
await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
await page.goto(URL, { waitUntil: "networkidle2", timeout: 20000 });
await waitMap(page);

// 1) 지도 메인
await shot(page, "01_map.png");

// 2) 이 지역 판매점 리스트
if (await clickByTextOrAria(page, { text: "보기" })) {
  await sleep(1500);
  await shot(page, "02_list.png");
  // 3) 리스트 첫 항목 버튼 클릭 → 지도+정보창(길찾기)
  const opened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const el = btns.find((b) => {
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      return /(점|복권방|복권|마트|식품)/.test(t) && /서울|경기|구|로|길/.test(t) && b.offsetHeight > 40;
    });
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
    return false;
  });
  if (opened) { await sleep(2000); await shot(page, "03_detail.png"); }
}

// 4) 검색 화면
await page.goto(URL, { waitUntil: "networkidle2", timeout: 20000 });
await waitMap(page);
if (await clickByTextOrAria(page, { aria: "판매점 검색" })) {
  await sleep(1000);
  await page.keyboard.type("강남", { delay: 60 });
  await sleep(1200);
  await shot(page, "04_search.png");
}

await browser.close();
console.log("done");

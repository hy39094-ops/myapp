// sportstoto.co.kr/find_store.php 의 모든 가맹점을 수집해서
// public/stores.json 으로 저장합니다.
//
// 사용: node scripts/scrape-stores.mjs
//
// 각 페이지의 <tr class="get-location" ...> 행에서
//   name="..."  → 상호
//   data-loc1="..." → 주소
//   x-axis="..." → 경도 (lng)
//   y-axis="..." → 위도 (lat)
// 를 추출합니다.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "public", "stores.json");

const BASE = "https://www.sportstoto.co.kr/find_store.php";
const CONCURRENCY = 6;
const RETRY = 3;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page, attempt = 1) {
  const url = `${BASE}?page=${page}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= RETRY) throw err;
    await sleep(RETRY_DELAY_MS * attempt);
    return fetchPage(page, attempt + 1);
  }
}

// HTML entity 간단 디코딩 (사이트가 쓰는 수준만 처리)
function decode(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseStores(html) {
  const rows = [];
  // <tr class="get-location" ... > 패턴
  const re =
    /<tr class="get-location"([^>]*?)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    const get = (name) => {
      const r = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return r ? decode(r[1].trim()) : "";
    };

    const name = get("name");
    const address = get("data-loc1");
    const xAxis = parseFloat(get("x-axis"));
    const yAxis = parseFloat(get("y-axis"));

    // <td class="loc1">서울</td> 에서 지역
    const regionMatch = /<td class="loc1">([^<]*)<\/td>/.exec(inner);
    const region = regionMatch ? decode(regionMatch[1].trim()) : "";

    if (
      !name ||
      !address ||
      Number.isNaN(xAxis) ||
      Number.isNaN(yAxis) ||
      xAxis === 0 ||
      yAxis === 0
    ) {
      continue;
    }

    rows.push({ name, address, region, lat: yAxis, lng: xAxis });
  }
  return rows;
}

function parseLastPage(html) {
  // 페이지네이션에서 가장 큰 page 번호 찾기
  let last = 1;
  const re = /find_store\.php\?page=(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > last) last = n;
  }
  return last;
}

async function runWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const total = items.length;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i]);
      } catch (err) {
        results[i] = { error: err.message, page: items[i] };
      }
      done++;
      if (done % 10 === 0 || done === total) {
        process.stdout.write(`\r  진행: ${done}/${total} 페이지`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next())
  );
  process.stdout.write("\n");
  return results;
}

async function main() {
  console.log("1) 첫 페이지로 총 페이지 수 확인...");
  const firstHtml = await fetchPage(1);
  const lastPage = parseLastPage(firstHtml);
  console.log(`   총 ${lastPage} 페이지`);

  const firstStores = parseStores(firstHtml);
  console.log(`   1페이지 ${firstStores.length}개 파싱 완료`);

  const pages = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
  console.log(`2) 2 ~ ${lastPage} 페이지 수집 (동시 ${CONCURRENCY})...`);
  const rest = await runWithConcurrency(
    pages,
    async (p) => {
      const html = await fetchPage(p);
      return parseStores(html);
    },
    CONCURRENCY
  );

  let all = [...firstStores];
  const failedPages = [];
  for (let i = 0; i < rest.length; i++) {
    const r = rest[i];
    if (!Array.isArray(r)) {
      failedPages.push(pages[i]);
      continue;
    }
    all.push(...r);
  }

  // 중복 제거: name + address
  const seen = new Set();
  const unique = [];
  for (const s of all) {
    const key = `${s.name}|${s.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  // id 부여
  const withId = unique.map((s, i) => ({ id: i + 1, ...s }));

  console.log(`3) 총 ${all.length}개 수집, 중복 제거 후 ${withId.length}개`);
  if (failedPages.length) {
    console.log(`   실패 페이지: ${failedPages.join(", ")}`);
  }

  // KST(+09:00) 기준 ISO 8601 문자열로 lastUpdated 기록
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstDate = new Date(now.getTime() + kstOffsetMs);
  const lastUpdated = kstDate.toISOString().replace("Z", "+09:00");

  const payload = {
    lastUpdated,
    count: withId.length,
    stores: withId,
  };

  const json = JSON.stringify(payload);
  await writeFile(OUTPUT, json, "utf8");
  const sizeKB = (json.length / 1024).toFixed(1);
  console.log(`4) 저장 완료: ${OUTPUT} (${sizeKB} KB)`);
  console.log(`   lastUpdated: ${lastUpdated}`);
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});

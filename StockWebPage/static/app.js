// ===== 6 鎖住用滾輪在下方圖放大
//         日期全部對齊
//         技術線跟條件判斷跟時間區隔 都會出現啦(待優化) =====
// ===== 問題: 優化所有 =====
console.log("app6");

// 後端 FastAPI 反向代理的前綴；用同源更簡單
const API_BASE = "/api";
const menuContainer = document.getElementById("menuContainer");
const dropdownMenu = document.getElementById("dropdownMenu");

window.priceChartInst = null;
window.volumeChartInst = null;

// 註冊點擊連結
async function handleRedirect() {
  const hash = window.location.hash;
  if (hash && hash.includes("access_token")) {
    const { data, error } = await client.auth.getSessionFromUrl({
      storeSession: true,
    });
    if (error) {
      console.error("處理 redirect 登入失敗:", error.message);
      return;
    }
    console.log("登入成功，使用者資訊：", data.session?.user);

    // 可導向到主畫面或清除 URL 中的 token
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
handleRedirect();

// 滑鼠移入顯示選單
menuContainer.addEventListener("mouseenter", () => {
  dropdownMenu.style.display = "block";
});

// 滑鼠移出整個容器隱藏選單
menuContainer.addEventListener("mouseleave", () => {
  dropdownMenu.style.display = "none";
});

// 登出
async function logout() {
  const { error } = await client.auth.signOut();
  if (!error) {
    alert("已登出");
    checkLoginStatus();
    hideMenu();
  }
}

// 判斷登入狀態
async function checkLoginStatus() {
  const {
    data: { user },
  } = await client.auth.getUser();

  const emailSpan = document.getElementById("user-email");
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const logoutBtn = document.getElementById("logout-btn");

  if (user) {
    emailSpan.textContent = user.email;
    emailSpan.style.display = "block";
    loginBtn.style.display = "none";
    registerBtn.style.display = "none";
    logoutBtn.style.display = "block";
  } else {
    emailSpan.textContent = "";
    emailSpan.style.display = "none";
    loginBtn.style.display = "block";
    registerBtn.style.display = "block";
    logoutBtn.style.display = "none";
  }
}

const hashParams = new URLSearchParams(window.location.hash.substring(1));
const accessToken = hashParams.get("access_token");
const refreshToken = hashParams.get("refresh_token");

if (accessToken && refreshToken) {
  supabase.auth
    .setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    .then(() => {
      // 成功登入，跳轉或顯示登入狀態
      window.location.hash = ""; // 清掉 URL hash
      alert("登入成功");
    });
}
window.onload = checkLoginStatus;

// 成交量壓縮比例（全域可調整） 0.3~0.6建議範圍
let VOL_PAD_TOP_RATIO = 0.1;
// === 指標清單（key = 後端欄位名, name = 圖例名, cb = checkbox 的 id）===
const INDICATORS = [
  { key: "Sma_5", name: "SMA_5", cb: "chkSma5" },
  { key: "Sma_10", name: "SMA_10", cb: "chkSma10" },
  { key: "Sma_20", name: "SMA_20", cb: "chkSma20" },
  { key: "Sma_60", name: "SMA_60", cb: "chkSma60" },
  // 之後要加 DIF/DEA/K/D...，照格式擴充即可
];

let chart;
let originalMinX = null;
let originalMaxX = null;

// === 視窗範圍工具（放這裡） ===
function getCurrentXRange() {
  const w = window.priceChartInst?.w;
  if (!w) return null;
  const min = w.globals?.minX;
  const max = w.globals?.maxX;
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function restoreXRange(range) {
  if (!range) return;
  // 等 ApexCharts 內部 update 完再套回，並且兩張圖都套
  setTimeout(() => {
    ["pricePane", "volumePane"].forEach((id) => {
      try {
        ApexCharts.exec(id, "zoomX", range.min, range.max);
      } catch (e) {}
    });
  }, 0);
}

//保持顯示技術線
//儲存目前勾選的函式
function getCheckedIndicators() {
  return Array.from(document.querySelectorAll(".indicator-check:checked")).map(
    (el) => el.value
  );
}

//還原勾選函式
function restoreCheckedIndicators(checkedIndicators) {
  document.querySelectorAll(".indicator-check").forEach((el) => {
    el.checked = checkedIndicators.includes(el.value);
  });
}

//套用勾選的線到圖表
function applyIndicators() {
  if (window.updateIndicatorsFromChecked) {
    window.updateIndicatorsFromChecked();
  }
}

//保持條件判斷選擇
//儲存條件判斷勾選狀態
function getCheckedRules() {
  return Array.from(document.querySelectorAll(".rule-check:checked")).map(
    (el) => el.value
  );
}

//還原條件判斷勾選狀態
function restoreCheckedRules(checkedRules) {
  document.querySelectorAll(".rule-check").forEach((el) => {
    el.checked = checkedRules.includes(el.value);
  });
}

//套用勾選的條件判斷到圖表
function applyRules() {
  document.querySelectorAll(".rule-check").forEach((checkbox) => {
    checkbox.onchange(); // 觸發 onchange 更新圖表標註
  });
}

const allIndicators = [
  "Sma_5",
  "Sma_10",
  "Sma_20",
  "Sma_60",
  "Sma_120",
  "Sma_240",
  "DIF",
  "DEA",
  "K",
  "D",
  "J",
  "Bias",
];

const indicatorGroups = {
  price: ["Sma_5", "Sma_10", "Sma_20", "Sma_60", "Sma_120", "Sma_240"], // 走價格軸(第0軸)
  macd: ["DIF", "DEA"], // 走第1軸
  kdj: ["K", "D", "J"], // 走第2軸
  bias: ["Bias"], // 走第3軸
};

function getSymbol() {
  return document.getElementById("symbolInput").value || "AAPL";
}

function selectSymbol(symbol) {
  const input = document.getElementById("symbolInput");
  const suggestionsDiv = document.getElementById("suggestions");
  const searchContainer = document.getElementById("searchContainer");
  const searchToggle = document.getElementById("searchToggle");

  // 更新輸入框內容
  if (input) input.value = symbol;

  // 關掉建議列表
  if (suggestionsDiv) suggestionsDiv.style.display = "none";

  // 🔹 收起搜尋膠囊，恢復左邊搜尋 icon
  if (searchContainer) searchContainer.classList.add("hidden");
  if (searchToggle) searchToggle.style.display = "flex";

  // （如果你 Enter 時有順便關閉自訂日期 / 控制面板，也可以一起放進來）
  const customDiv = document.getElementById("customDateRange");
  if (customDiv) customDiv.style.display = "none";

  const controlPanel = document.getElementById("controlPanel");
  if (controlPanel) controlPanel.classList.remove("open");

  // 載入新的股票
  loadStockWithRange(symbol, "3m");
}

async function loadStockWithRange(symbol, range) {
  const checkedIndicatorsBefore = getCheckedIndicators(); // 保留使用者勾選
  const checkedRulesBefore = getCheckedRules();

  // 自訂日期 → /api/stocks/range
  if (range === "custom") {
    const start = document.getElementById("customStart").value;
    const end = document.getElementById("customEnd").value;
    if (!start || !end) return alert("請先選擇起訖日期");

    const url = `${API_BASE}/stocks/range?symbol=${encodeURIComponent(
      symbol
    )}&start=${start}&end=${end}`;
    const resp = await fetch(url);
    if (!resp.ok) return alert("查詢失敗");
    const data = await resp.json();
    if (!data || data.length === 0) return alert("查無資料");

    displayStockData(data, symbol);
    restoreCheckedIndicators(checkedIndicatorsBefore);
    applyIndicators();
    restoreCheckedRules(checkedRulesBefore);
    applyRules();
    return;
  }

  // 快捷區間 → 用 count 呼叫 /api/stocks
  const rangeToCount = {
    "5d": 5,
    "1m": 22,
    "3m": 66,
    "6m": 132,
    "1y": 264,
    "3y": 792,
  };
  let count = rangeToCount[range] || 264;

  // YTD 用日數估算（工作天更精準可改後端）
  if (range === "ytd") {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const diffTime = Math.abs(today - startOfYear);
    count = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  const url = `${API_BASE}/stocks?symbol=${encodeURIComponent(
    symbol
  )}&count=${count}`;
  const resp = await fetch(url);
  if (!resp.ok) return alert("查詢失敗");
  const data = await resp.json();
  if (!data || data.length === 0) return alert("查無資料");

  // 後端已經照日期 ASC 排好就不用再 sort
  displayStockData(data, symbol);

  // 還原使用者勾選與條件標註
  restoreCheckedIndicators(checkedIndicatorsBefore);
  applyIndicators();
  restoreCheckedRules(checkedRulesBefore);
  applyRules();

  console.log("symbol:", symbol, "count:", count);
}

function displayStockData(data, symbol) {
  window.stockData = data;

  // X 軸交易日（字串，和 xaxis.categories 對齊）
  window.tradingDates = data.map((row) => {
    const d = new Date(row.date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // 上圖：K線
  const chartData = data.map((row, idx) => ({
    x: window.tradingDates[idx],
    y: [+row.open, +row.high, +row.low, +row.close],
  }));

  // 下圖：成交量
  const volData = (window.stockData || []).map((row, idx) => {
    const open = +row.open || 0;
    const close = +row.close || 0;
    const up = close >= open;
    return {
      x: window.tradingDates[idx],
      y: +row.volume || 0,
      fillColor: up ? "#e74c3c" : "#2ecc71",
    };
  });

  // ---- 統計 y 軸範圍並保底 ----
  const volArr = data.map((r) => (Number.isFinite(+r.volume) ? +r.volume : 0));
  const volMax = Math.max(1, ...volArr);
  // 建議 VOL_PAD_TOP_RATIO 設 0.1~0.2，避免柱子太矮
  const pad = typeof VOL_PAD_TOP_RATIO === "number" ? VOL_PAD_TOP_RATIO : 0.15;
  const volYMin = 0;
  const volYMax = Math.ceil(volMax * (1 + pad));

  // 標題
  document.getElementById("chartTitle").innerText = `${symbol}`;
  document.getElementById("ohlcInfo").innerHTML =
    "將滑鼠懸停在圖表上以查看詳細資訊";

  // // K 線
  // const kSeries = [
  //   {
  //     name: "Price",
  //     type: "candlestick",
  //     data: window.stockData.map((row, i) => ({
  //       x: window.tradingDates[i],
  //       y: [row.open, row.high, row.low, row.close],
  //     })),
  //   },
  // ];

  // // 成交量
  // const volSeries = [
  //   {
  //     name: "Volume",
  //     type: "bar",
  //     data: window.stockData.map((row, i) => ({
  //       x: window.tradingDates[i],
  //       y: row.volume ?? 0,
  //     })),
  //   },
  // ];

  // 先把舊圖清掉
  if (
    window.priceChartInst &&
    typeof window.priceChartInst.destroy === "function"
  ) {
    window.priceChartInst.destroy();
    window.priceChartInst = null;
  }
  if (
    window.volumeChartInst &&
    typeof window.volumeChartInst.destroy === "function"
  ) {
    window.volumeChartInst.destroy();
    window.volumeChartInst = null;
  }

  // 給價格圖用
  const GRID_PAD_PRICE = { top: 0, right: 0, bottom: -5, left: 16 };

  // 給成交量圖用（多留一點左邊，讓它看起來跟價格圖對齊）
  // 這邊 26 可以自己微調成 22、24、28，看畫面順眼就好
  const GRID_PAD_VOLUME = { top: -20, right: -25, bottom: 0, left: 28 };

  // ===== 上方「價格＋技術線」圖 =====
  const optionsPrice = {
    chart: {
      id: "pricePane",
      group: "stockPane", // 與下方 volume 同 group → 縮放/滾動同步
      type: "candlestick",
      height: 370,
      zoom: { enabled: true, type: "x", autoScaleYaxis: false }, // ← 加這行
      events: {
        mounted: function () {
          ensureVolumeAxis();
        },

        // 只要有縮放，就重新依照目前 checkbox 狀態決定哪些 y 軸要 show
        zoomed: function () {
          if (!chart || !chart.w) return;

          const checked = getCheckedIndicators?.() ?? [];

          const showMacd = checked.some((n) =>
            indicatorGroups.macd.includes(n)
          );
          const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
          const showBias = checked.some((n) =>
            indicatorGroups.bias.includes(n)
          );

          chart.updateOptions(
            {
              yaxis: [
                { ...chart.w.config.yaxis[0], show: true }, // 價格 / SMA 永遠顯示
                { ...chart.w.config.yaxis[1], show: showMacd }, // 只在 DIF/DEA 有勾的時候
                { ...chart.w.config.yaxis[2], show: showKdj }, // 只在 K/D/J 有勾的時候
                { ...chart.w.config.yaxis[3], show: showBias }, // 只在 Bias 有勾的時候
              ],
            },
            false,
            false
          );

          // 順便再修一次成交量 y 軸（保險）
          ensureVolumeAxis();
        },
      },
    },
    legend: { show: false },
    grid: { padding: GRID_PAD_PRICE },

    plotOptions: {
      candlestick: {
        colors: { upward: "#e74c3c", downward: "#2ecc71" },
      },
      bar: { columnWidth: "70%" },
    },
    states: {
      hover: { filter: { type: "darken", value: 0.7 } },
      active: { filter: { type: "darken", value: 1.5 } },
    },
    xaxis: buildSharedXAxis(),

    yaxis: [
      {
        // 0: 價格 / SMA
        title: { text: "價格 / SMA" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        tickAmount: 4,
        opposite: false,
        show: true,
        // 這裡把所有價格級別系列都綁到同一個軸
        seriesName: [
          "K線圖",
          "Sma_5",
          "Sma_10",
          "Sma_20",
          "Sma_60",
          "Sma_120",
          "Sma_240",
        ],
      },
      {
        // 1: MACD (DIF/DEA)
        title: { text: "MACD" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["DIF", "DEA"],
      },
      {
        // 2: KDJ (K/D/J)
        title: { text: "KDJ" },
        labels: { formatter: (v) => Number(v.toFixed(0)) },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["K", "D", "J"],
      },
      {
        // 3: Bias
        title: { text: "Bias" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        opposite: true,
        show: false,
        seriesName: ["Bias"],
      },
    ],

    series: [
      { name: "K線圖", type: "candlestick", data: chartData },
      //  不在這裡放成交量！成交量在另一張圖
    ],
    tooltip: {
      shared: true,
      custom: function ({ series, dataPointIndex, w }) {
        const ohlc = w.globals.initialSeries[0].data[dataPointIndex].y;
        const date = window.tradingDates[dataPointIndex];
        // 紅漲綠跌：up / down class
        const trendClass = ohlc[3] >= ohlc[0] ? "up" : "down";

        // 成交量已不在同一圖 → 直接取原始資料
        const volRaw = window.stockData?.[dataPointIndex]?.volume ?? null;
        function fmtVol(val) {
          if (val == null) return "";
          if (val >= 1e9) return (val / 1e9).toFixed(0) + "B";
          if (val >= 1e6) return (val / 1e6).toFixed(0) + "M";
          if (val >= 1e3) return (val / 1e3).toFixed(0) + "K";
          return String(val);
        }

        // 只顯示「目前有勾選」的技術線
        let techLinesHtml = "";
        const checked = getCheckedIndicators?.() ?? [];
        checked.forEach((name) => {
          const idx = w.globals.seriesNames.indexOf(name);
          if (idx >= 0) {
            const val = series[idx][dataPointIndex];
            if (val != null) {
              techLinesHtml += `<div style="color:${
                indicatorColors[name] || "#000"
              }">${name}: ${val.toFixed(2)}</div>`;
            }
          }
        });

        // 同步上方資訊列
        const info = document.getElementById("ohlcInfo");
        if (info) {
          info.innerHTML = `
            <span class="ohlc-item">
              <span class="ohlc-label">開</span>
              <span class="ohlc-value ${trendClass}">${ohlc[0].toFixed(
            2
          )}</span>
            </span>
            <span class="ohlc-item">
              <span class="ohlc-label">高</span>
              <span class="ohlc-value ${trendClass}">${ohlc[1].toFixed(
            2
          )}</span>
            </span>
            <span class="ohlc-item">
              <span class="ohlc-label">低</span>
              <span class="ohlc-value ${trendClass}">${ohlc[2].toFixed(
            2
          )}</span>
            </span>
            <span class="ohlc-item">
              <span class="ohlc-label">收</span>
              <span class="ohlc-value ${trendClass}">${ohlc[3].toFixed(
            2
          )}</span>
            </span>
          `;
        }

        return `
          <div style="background:rgba(255,255,255,0.85); padding:8px; border-radius:6px; font-size:13px;">
            <div style="font-weight:bold; margin-bottom:4px;">${date}</div>
            <div style="color:#555;">成交量: ${fmtVol(volRaw)}</div>
            ${techLinesHtml}
          </div>`;
      },
    },
  };

  // 紅/綠互斥的兩條成交量序列
  // const volUp = data.map((r) =>
  //   Number(r.close) >= Number(r.open) ? Number(r.volume) : null
  // );
  // const volDown = data.map((r) =>
  //   Number(r.close) < Number(r.open) ? Number(r.volume) : null
  // );

  // ===== 下方「成交量」圖 =====
  const optionsVolume = {
    chart: {
      id: "volumePane",
      group: "stockPane", // 和上方價格圖同一個 group
      type: "bar",
      parentHeightOffset: 0, //  取消預設 15px 外距
      height: 130,
      toolbar: { show: false }, //  不要讓縮放自動亂動 y 軸，並在縮放後再套一次我們自己的 y 軸設定
      zoom: {
        enabled: false, // 不允許直接在成交量圖上縮放，只當跟隨者
      },
    },

    plotOptions: {
      bar: {
        columnWidth: "70%",
        // （可選）視覺更乾淨一點：圓角 & 無邊框
        borderRadius: 2,
      },
    },
    stroke: { width: 0 },

    //  讓時間刻度不擋到柱子（可保留原本 categories）
    grid: { padding: GRID_PAD_VOLUME },
    xaxis: buildSharedXAxis(),
    yaxis: makeVolumeYAxis(),

    dataLabels: { enabled: false },
    tooltip: {
      enabled: true,
      shared: false,
      //y: { formatter: formatVolume },   // ← 這行讓滑鼠提示也顯示 K/M/B
      intersect: true,
      custom: () => "", // 不渲染內容（保險）
    },
    states: {
      // 成交量的陰影
      normal: { filter: { type: "none", value: 0 } },
      hover: { filter: { type: "darken", value: 0.55 } }, // 0.45~0.65 可調
      active: { filter: { type: "darken", value: 0.55 } },
    },
    series: [
      {
        name: "Volume",
        type: "bar",
        data: volData,
      },
    ],
  };

  // 3) new（只 new 一次）
  window.priceChartInst = new ApexCharts(
    document.querySelector("#priceChart"),
    optionsPrice
  );
  window.volumeChartInst = new ApexCharts(
    document.querySelector("#volumeChart"),
    optionsVolume
  );

  // 4) render（只 render 一次）
  Promise.all([
    window.priceChartInst.render(),
    window.volumeChartInst.render(),
  ]).then(() => {
    chart = window.priceChartInst;
    syncXAxes(); // 兩張圖吃同一份 categories
    ensureVolumeAxis(); // 確保 volume y 軸用到最新資料
  });

  // ===== 還原原本的「勾選技術指標」行為（重要：不要把成交量塞回主圖）=====
  const indicatorFieldMap = {
    Sma_5: "Sma_5",
    Sma_10: "Sma_10",
    Sma_20: "Sma_20",
    Sma_60: "Sma_60",
    Sma_120: "Sma_120",
    Sma_240: "Sma_240",
    DIF: "DIF",
    DEA: "DEA",
    K: "K",
    D: "D",
    J: "J",
    Bias: "Bias",
  };

  // 單次批次更新技術線（給 onchange 和 applyIndicators 共用）
  window.updateIndicatorsFromChecked = () => {
    const checked = Array.from(
      document.querySelectorAll(".indicator-check:checked")
    ).map((cb) => cb.value);

    const range = getCurrentXRange(); // 記住目前視窗

    let newSeries = [{ name: "K線圖", type: "candlestick", data: chartData }];

    const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
    const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
    const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

    checked.forEach((name) => {
      const field = indicatorFieldMap[name];
      if (!field) return;
      const dataSeries = window.stockData.map((row, idx) => ({
        x: window.tradingDates[idx],
        y: row[field] != null ? parseFloat(row[field]) : null,
      }));

      let yAxisIndex = 0;
      if (indicatorGroups.macd.includes(name)) yAxisIndex = 1;
      else if (indicatorGroups.kdj.includes(name)) yAxisIndex = 2;
      else if (indicatorGroups.bias.includes(name)) yAxisIndex = 3;

      newSeries.push({
        name,
        type: "line",
        data: dataSeries,
        yAxisIndex,
        color: indicatorColors[name] || "#000",
      });
    });

    // 只換 series，不動 xaxis
    chart.updateSeries(newSeries, false);

    // 只調 y 軸顯示與否
    chart.updateOptions(
      {
        yaxis: [
          { ...chart.w.config.yaxis[0], show: true },
          { ...chart.w.config.yaxis[1], show: showMacd },
          { ...chart.w.config.yaxis[2], show: showKdj },
          { ...chart.w.config.yaxis[3], show: showBias },
        ],
      },
      false,
      false
    );

    // 套回視窗（兩張圖）
    restoreXRange(range);

    // 只重算成交量 y 軸，不動 x 軸
    ApexCharts.exec(
      "volumePane",
      "updateOptions",
      { yaxis: makeVolumeYAxis() },
      false,
      false
    );
  };

  document.querySelectorAll(".indicator-check").forEach((checkbox) => {
    checkbox.onchange = window.updateIndicatorsFromChecked;
  });

  // 初次載入：把已勾選的線套上
  if (typeof restoreCheckedIndicators === "function") {
    restoreCheckedIndicators(getCheckedIndicators());
  }
  if (typeof applyIndicators === "function") {
    applyIndicators();
  }

  // 區隔線（若你有打開）
  if (showPeriods) addPeriodSeparators(currentMonths);
}

function formatVolume(val) {
  if (val == null || isNaN(val)) return "";
  const n = +val;
  if (n >= 1e9) return (n / 1e9).toFixed(0) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(0) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(Math.round(n));
}

function makeVolumeYAxis() {
  const arr = (window.stockData || []).map((r) => +r.volume || 0);
  const vmax = Math.max(1, ...arr);
  const ratio = window.VOL_PAD_TOP_RATIO ?? 0.18;
  return {
    title: { text: "Volume", offsetX: 5 }, // 每次更新時都帶上，避免被覆蓋_offsetX往右推一點，讓位置跟「價格 / SMA」比較靠近
    min: 0,
    max: Math.ceil(vmax * (1 + ratio)),
    labels: { offsetX: 15, formatter: formatVolume },
  };
}

// X 軸永遠使用目前的 categories（交易日字串）
function makeXAxisCategories() {
  return {
    type: "category",
    categories: window.tradingDates,
    // tickAmount: Math.min(12, window.tradingDates?.length || 12),
    // labels: { rotate: -45 },
    // tooltip: { enabled: false },
    tickAmount: Math.min(12, window.tradingDates?.length || 12),
    tickPlacement: "on", // 兩張圖一致，避免一張在格線上、一張在格線間
    labels: {
      show: true, // ← 顯示日期
      rotate: -45,
      hideOverlappingLabels: true,
      offsetY: 6,
    },
    axisBorder: { show: true },
    axisTicks: { show: true },
    tooltip: { enabled: false },
  };
}

function formatDateMMDD(val) {
  if (!val) return "";
  const s = String(val);
  // 期待格式是 YYYY-MM-DD
  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length === 3) {
      return `${parts[1].padStart(2, "0")}/${parts[2].padStart(2, "0")}`;
    }
  }
  return s; // 萬一不是這種格式，就原樣顯示
}

function getTickAmountByMonths() {
  const m = window.currentMonths || 3;
  if (m >= 36) return 14;
  if (m >= 12) return 14;
  if (m >= 6) return 12;
  if (m >= 3) return 12;
  return Math.min(10, window.tradingDates?.length || 10); // 1m
}

function buildSharedXAxis() {
  const cats = window.tradingDates || [];
  return {
    type: "category",
    categories: cats,
    tickAmount: Math.min(getTickAmountByMonths(), cats.length),
    tickPlacement: "on",
    labels: {
      show: true,
      rotate: 0,
      offsetY: 6,
      hideOverlappingLabels: true,
      formatter: (val) => formatDateMMDD(val), // ⬅ 這行改成 mm/dd
    },
    axisBorder: { show: true },
    axisTicks: { show: true },
    tooltip: { enabled: false },
  };
}

function syncXAxes() {
  const base = buildSharedXAxis(); // 已經是 mm/dd formatter 了

  // K 線圖：只用 x 軸對齊，但不顯示刻度文字 / ticks
  const priceXAxis = {
    ...base,
    labels: {
      ...(base.labels || {}),
      show: false, // ⬅ 不顯示日期文字
    },
    axisTicks: {
      ...(base.axisTicks || {}),
      show: false, // ⬅ 不顯示小刻度
    },
  };

  // 成交量圖：照 base（會顯示 mm/dd）
  const volumeXAxis = base;

  ApexCharts.exec(
    "pricePane",
    "updateOptions",
    { xaxis: priceXAxis },
    false,
    false
  );
  ApexCharts.exec(
    "volumePane",
    "updateOptions",
    { xaxis: volumeXAxis },
    false,
    false
  );
}

function recomputeVolumeAxis() {
  if (!window.volumeChart) return;
  window.volumeChart.updateOptions({ yaxis: makeVolumeYAxis() }, false, false);
}

function updateVolRatio(value) {
  VOL_PAD_TOP_RATIO = parseFloat(value);
  const label = document.getElementById("volRatioValue");
  if (label) label.textContent = value;

  if (window.volumeChart && window.stockData) {
    const arr = (window.stockData || []).map((r) => +r.volume || 0);
    const vmax = Math.max(1, ...arr);
    const vmin = 0;
    const vmaxAdj = Math.ceil(vmax * (1 + VOL_PAD_TOP_RATIO));

    window.volumeChart.updateOptions(
      {
        yaxis: {
          ...makeVolumeYAxis(), // 保留 title 與 labels.formatter
          min: vmin,
          max: vmaxAdj,
        },
      },
      false,
      false
    );
  }
}

let __lastCatsLen = null; // 放在全域

function ensureVolumeAxis() {
  if (!window.stockData) return;
  const opt = {
    yaxis: makeVolumeYAxis(),
    tooltip: { y: { formatter: formatVolume } },
  };
  ApexCharts.exec("volumePane", "updateOptions", opt, false, false);
}

function highlightConditions(rules) {
  if (!window.stockData || window.stockData.length === 0) return;

  let annotations = [];

  if (rules.length === 0) {
    //  這裡也要保留 xaxis，不能清空
    const existing = chart.w.config.annotations || {};
    const existingXaxis = Array.isArray(existing.xaxis) ? existing.xaxis : [];
    const existingPoints = Array.isArray(existing.points)
      ? existing.points
      : [];

    // 保留 period-label
    const preservedPeriod = existingPoints.filter((p) => {
      const css = p.label?.cssClass || "";
      return css.includes("period-label");
    });

    chart.updateOptions({
      annotations: {
        xaxis: existingXaxis,
        points: preservedPeriod, // 沒有新規則 → 只保留 period
      },
    });
    return;
  }

  window.stockData.forEach((row, i) => {
    const prev = window.stockData[i - 1];
    const prev2 = window.stockData[i - 2];
    if (!prev || !prev2) return;

    const sma5 = parseFloat(row["Sma_5"]);
    const sma20 = parseFloat(row["Sma_20"]);
    const prevSma5 = parseFloat(prev["Sma_5"]);
    const prevSma20 = parseFloat(prev["Sma_20"]);
    const macd = parseFloat(row["DIF"]);
    const macdSignal = parseFloat(row["DEA"]);
    const prevMacd = parseFloat(prev["DIF"]);
    const prevMacdSignal = parseFloat(prev["DEA"]);
    const k = parseFloat(row["K"]);
    const d = parseFloat(row["D"]);
    const prevK = parseFloat(prev["K"]);
    const prevD = parseFloat(prev["D"]);
    const bias = parseFloat(row["Bias"]);

    // 定義文字對應
    const labelMap = {
      "sma-cross": "SMA↑",
      "dif-above-dea": "MACD↑",
      "dea-below-dif": "MACD↓",
      "kd-cross": "KD↑",
      "bias-high": "偏離↑",
      "bias-low": "偏離↓",
      "three-red": "連",
      "three-down-volume": "量↓",
    };

    // 畫倒三角形的工具
    function makePoint(x, y, text, color = "#FF4560") {
      return {
        x: window.tradingDates[i],
        y: row.low * 0.98,
        marker: {
          size: 5, // 比原本大一點
          fillColor: "#000000", // 黑色實心
          strokeColor: "#000000",
          shape: "triangle",
        },
        label: {
          borderColor: "transparent",
          offsetY: 30,
          style: {
            background: "transparent",
            color: "#000000",
            fontSize: "12px",
            fontWeight: "bold",
          },
          text: text,
        },
      };
    }

    // 定義條件
    const checks = {
      "sma-cross": () => prevSma5 < prevSma20 && sma5 >= sma20,
      // DIF 上穿 DEA → MACD↑
      "dif-above-dea": () => prevMacd < prevMacdSignal && macd >= macdSignal,
      // DEA 下穿 DIF → MACD↓
      "dea-below-dif": () => prevMacdSignal < prevMacd && macdSignal >= macd,
      "kd-cross": () => prevK < prevD && k >= d && k < 20,
      "bias-high": () => bias > 5,
      "bias-low": () => bias < -5,
      "three-red": () =>
        [row, prev, prev2].every(
          (r) => parseFloat(r.close) > parseFloat(r.open)
        ),
      "three-down-volume": () =>
        row.volume < prev.volume && prev.volume < prev2.volume,
    };

    // 單選 → 單一條件
    if (rules.length === 1) {
      if (checks[rules[0]] && checks[rules[0]]()) {
        annotations.push(makePoint(i, row.close, labelMap[rules[0]]));
      }
    }
    // 複選 → 所有條件都成立
    else {
      const allPass = rules.every((r) => checks[r] && checks[r]());
      if (allPass) {
        // 將多個條件文字組合
        const text = rules.map((r) => labelMap[r]).join("");
        annotations.push(makePoint(i, row.close, text));
      }
    }
  });

  // 讀取現有 annotations
  const existing = chart.w.config.annotations || {};
  const existingXaxis = Array.isArray(existing.xaxis) ? existing.xaxis : [];
  const existingPoints = Array.isArray(existing.points) ? existing.points : [];

  // 只保留 period label
  const preservedPeriod = existingPoints.filter((p) => {
    const css = p.label?.cssClass || "";
    return css.includes("period-label");
  });

  // highlight
  const highlightPoints = annotations.map((a) => ({
    ...a,
    label: {
      ...(a.label || {}),
      cssClass:
        (a.label && a.label.cssClass ? a.label.cssClass + " " : "") +
        "highlight-marker",
    },
  }));

  // 合併 → 保留分隔線 + period-label + 新的三角形
  chart.updateOptions({
    annotations: {
      xaxis: existingXaxis, // 保留區間分隔線
      points: annotations, // 替換新的條件標註
    },
  });
}

document.querySelectorAll(".rule-check").forEach((cb) => {
  cb.onchange = () => {
    const rules = Array.from(
      document.querySelectorAll(".rule-check:checked")
    ).map((c) => c.value);
    highlightConditions(rules);
  };
});

function toggleCustomDate() {
  const div = document.getElementById("customDateRange");
  const btn = document.querySelector(".calendar-btn"); // 日曆那顆
  if (!div || !btn) return;

  console.log("toggleCustomDate fired");

  const isHidden = window.getComputedStyle(div).display === "none";

  if (isHidden) {
    // 1. 顯示出來，先讓瀏覽器算出寬度
    div.style.display = "flex";
    div.style.position = "fixed";
    div.style.zIndex = "9999";
    div.style.flexDirection = "column";
    div.style.alignItems = "stretch";
    div.style.gap = "8px";

    div.style.padding = "8px 12px";
    div.style.backgroundColor = "#ffffff";
    div.style.borderRadius = "8px";
    div.style.border = "1px solid #ddd";
    div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";

    // 2. 算出日曆按鈕位置 & 卡片寬度
    const btnRect = btn.getBoundingClientRect();
    const cardRect = div.getBoundingClientRect();

    // 讓「卡片右邊」對齊「日曆按鈕右邊」
    let left = btnRect.right - cardRect.width;

    // 最多貼齊畫面左邊，不要跑出去
    left = Math.max(left, 8);

    div.style.top = btnRect.bottom + 6 + "px";
    div.style.left = left + "px";
  } else {
    div.style.display = "none";
  }
}

// 時間功能列
function setActive(el, range) {
  document
    .querySelectorAll(".time-range-item")
    .forEach((item) => item.classList.remove("active"));
  el.classList.add("active");

  // 切換其它區間時，先收起自訂時間
  const customDiv = document.getElementById("customDateRange");
  if (customDiv) {
    customDiv.style.display = "none"; // 切換區間時就把懸浮框收起來
  }

  loadStockWithRange(getSymbol(), range).then(() => {
    let months = 3;
    if (range === "1m") months = 1;
    else if (range === "3m") months = 3;
    else if (range === "6m") months = 6;
    else if (range === "1y") months = 12;
    else if (range === "3y") months = 36;
    else if (range === "5d") months = 1;
    else if (range === "ytd") months = 12;

    currentMonths = months;

    if (showPeriods) {
      addPeriodSeparators(currentMonths);
    } else if (chart) {
      chart.clearAnnotations();
    }
    // ensureVolumeAxis / syncXAxes 已在 displayStockData render 完後呼叫
  });
}

// function toggleCustomDate() {
//   const container = document.getElementById("customDateRange");
//   const isHidden =
//     container.style.display === "none" || container.style.display === "";
//   // 顯示或隱藏
//   container.style.display = isHidden ? "flex" : "none";
//   // 取消其他時間按鈕的選中狀態
//   document
//     .querySelectorAll(".time-range-item")
//     .forEach((item) => item.classList.remove("active"));
// }

// 畫圖?
function makeAnnotation(time, label, color = "#FF4560") {
  return {
    x: new Date(time).getTime(),
    borderColor: color,
    label: {
      borderColor: color,
      style: {
        color: "#fff",
        background: color,
        fontSize: "12px",
        padding: "2px 4px",
      },
      text: label,
      orientation: "horizontal",
      offsetY: 20,
    },
  };
}
const symbolInput = document.getElementById("symbolInput");
const suggestions = document.getElementById("suggestions");

if (symbolInput) {
  symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = symbolInput.value.trim();
      if (text) {
        // 直接當成股票代碼查詢（你也可以先轉成大寫）
        selectSymbol(text.toUpperCase());
      }

      // 查完就收起膠囊、顯示回放大鏡
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";

      // 把建議清掉
      if (suggestions) suggestions.style.display = "none";

      // 按 Enter 查詢時，一併確保自訂日期 / 控制面板關掉
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) customDiv.style.display = "none";
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) controlPanel.classList.remove("open");
    } else if (e.key === "Escape") {
      // 按 Esc 也可以關閉搜尋框，不查詢
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";
      if (suggestions) suggestions.style.display = "none";
    }
  });
}

// 輸入文字時 → 模糊搜尋
// 輸入時：模糊搜尋
symbolInput.addEventListener("input", async (e) => {
  const keyword = e.target.value.trim();
  if (!keyword) {
    suggestions.style.display = "none";
    return;
  }
  try {
    const resp = await fetch(
      `${API_BASE}/suggest?q=${encodeURIComponent(keyword)}&limit=10`
    );
    if (!resp.ok) throw new Error("suggest failed");
    const data = await resp.json();
    renderSuggestions(data);
  } catch (err) {
    suggestions.innerHTML = `<div style='padding:8px;'>查詢失敗</div>`;
    suggestions.style.display = "block";
  }
});

// 聚焦時：抓前 10 筆熱門（或後端回任意 10 筆）
symbolInput.addEventListener("focus", async () => {
  try {
    const resp = await fetch(`${API_BASE}/suggest?limit=10`);
    if (!resp.ok) throw new Error("suggest failed");
    const data = await resp.json();
    renderSuggestions(data);
  } catch (err) {
    suggestions.innerHTML = `<div style='padding:8px;'>查詢失敗</div>`;
    suggestions.style.display = "block";
  }
});

function renderSuggestions(data, error) {
  if (error || !data || data.length === 0) {
    suggestions.innerHTML = `<div style='padding:8px;'>無符合股票</div>`;
    suggestions.style.display = "block";
    return;
  }

  suggestions.innerHTML = data
    .map((item) => {
      const nameDisplay =
        item.name_zh ||
        item.name_en ||
        item.short_name_zh ||
        item.short_name_en ||
        "";
      return `<div style='padding:8px; cursor:pointer' onclick='selectSymbol("${item.symbol}")'>
                ${item.symbol} - ${nameDisplay}
              </div>`;
    })
    .join("");
  suggestions.style.display = "block";
}

// Hide suggestions when clicking outside
document.addEventListener("click", function (event) {
  const suggestionsDiv = document.getElementById("suggestions");
  const input = document.getElementById("symbolInput");
  if (!suggestionsDiv.contains(event.target) && event.target !== input) {
    suggestionsDiv.style.display = "none";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  // 預設載入 AAPL 3 個月
  loadStockWithRange("AAPL", "3m");

  // 搜尋圖示 → 展開膠囊搜尋框（同時隱藏圖示）
  const searchToggle = document.getElementById("searchToggle");
  const searchContainer = document.getElementById("searchContainer");
  if (searchToggle && searchContainer) {
    searchToggle.addEventListener("click", () => {
      // 顯示膠囊框
      searchContainer.classList.remove("hidden");
      // 隱藏放大鏡按鈕
      searchToggle.style.display = "none";

      //  1. 關閉「自訂日期」懸浮視窗
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) {
        customDiv.style.display = "none"; // 我們現在是用 inline style 控制
      }

      //  2. 關閉右側控制面板
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) {
        controlPanel.classList.remove("open"); // 拿掉 open class → 收起
      }

      const input = document.getElementById("symbolInput");
      if (input) {
        input.focus();
        input.select(); // 把原本文字全選，方便直接輸入
      }
    });
  }
  //  膠囊內的放大鏡 → 關閉搜尋框，恢復原本搜尋按鈕
  const pillIcon = document.querySelector(".search-pill-icon");
  if (pillIcon && searchContainer && searchToggle) {
    pillIcon.addEventListener("click", () => {
      // 收起膠囊
      searchContainer.classList.add("hidden");
      // 顯示左邊原本那顆搜尋按鈕
      searchToggle.style.display = "flex";

      // 把建議列表也順便關掉
      if (typeof suggestions !== "undefined" && suggestions) {
        suggestions.style.display = "none";
      }
    });
  }

  // === 初始化 flatpickr 自訂日期 ===
    // === 初始化 flatpickr 自訂日期 ===
  if (window.flatpickr) {
    // 改成繁體中文（如果載不到就用預設）
    if (flatpickr.l10ns && flatpickr.l10ns.zh_tw) {
      flatpickr.localize(flatpickr.l10ns.zh_tw);
    }

    const commonOptions = {
      dateFormat: "Y-m-d",  // 傳給後端的格式
      maxDate: "today",
      allowInput: false,    // 不用手動輸入
    };

    flatpickr("#customStart", commonOptions);
    flatpickr("#customEnd", commonOptions);
  } else {
    console.warn("flatpickr not loaded");
  }


  //  控制面板按鈕 → 開關控制面板
  const controlBtn = document.getElementById("controlPanelToggle");
  const controlPanel = document.getElementById("controlPanel");
  if (controlBtn && controlPanel) {
    controlBtn.addEventListener("click", () => {
      const isOpen = controlPanel.classList.toggle("open");
      controlBtn.classList.toggle("active", isOpen); // 🔹開啟時加 active
    });
  }

  // 預設把 3m 的按鈕標成 active
  const defaultBtn = document.querySelector(
    ".time-range-item[onclick*=\"'3m'\"]"
  );
  if (defaultBtn) {
    defaultBtn.classList.add("active");
  }
});

// 統一顏色表
const indicatorColors = {
  Sma_5: "#e74c3c", // 紅
  Sma_10: "#3498db", // 藍
  Sma_20: "#27ae60", // 綠
  Sma_60: "#f39c12", // 橘
  Sma_120: "#9b59b6", // 紫
  Sma_240: "#16a085", // 青
  DIF: "#d35400", // 深橘
  DEA: "#8e44ad", // 深紫
  K: "#2ecc71", // 淺綠
  D: "#2980b9", // 深藍
  J: "#c0392b", // 暗紅
  Bias: "#7f8c8d", // 灰
};

// 初始化時，讓 checkbox label 文字顏色一致
document.querySelectorAll(".indicator-check").forEach((cb) => {
  const color = indicatorColors[cb.value];
  if (color) {
    cb.parentElement.style.color = color;
    cb.dataset.color = color; // 儲存顏色以便後續使用
  }
});

// === 劃分區間 + 加上標註 ===
function addPeriodSeparators(periodMonths) {
  if (!window.tradingDates || window.tradingDates.length === 0) return;
  if (!chart || !chart.w) return;

  // 1個月 → 不畫區隔
  if (periodMonths === 1) {
    chart.updateOptions({
      annotations: {
        xaxis: [],
        points: chart.w.config.annotations.points || [],
      },
    });
    return;
  }

  const startDate = new Date(window.tradingDates[0]);
  const endDate = new Date(window.tradingDates[window.tradingDates.length - 1]);
  const totalMs = endDate - startDate;
  if (totalMs <= 0) return;

  let sections;
  let labels = [];

  if (periodMonths >= 12) {
    // 年度 → 用季度
    sections = 4;
    labels = ["Q1", "Q2", "Q3", "Q4"];
  } else {
    // 其他 → 按月份數量切
    sections = periodMonths;
    labels = Array.from({ length: sections }, (_, i) => (i + 1).toString());
  }

  const interval = totalMs / sections;
  const xaxisAnnotations = [];
  const pointAnnotations = [];

  const yTop =
    (chart.w &&
      chart.w.config &&
      chart.w.config.yaxis &&
      chart.w.config.yaxis[0] &&
      chart.w.config.yaxis[0].max) ||
    null;

  for (let i = 0; i < sections; i++) {
    const sectionStart = new Date(startDate.getTime() + interval * i);
    const sectionEnd = new Date(startDate.getTime() + interval * (i + 1));
    const middle = new Date(
      (sectionStart.getTime() + sectionEnd.getTime()) / 2
    );

    let middleIndex = window.tradingDates.findIndex(
      (d) => new Date(d).getTime() >= middle.getTime()
    );
    if (middleIndex === -1) middleIndex = window.tradingDates.length - 1;

    // Q1/Q2... or 數字
    pointAnnotations.push({
      x: window.tradingDates[middleIndex],
      y: yTop ? yTop * 0.98 : undefined,
      marker: { size: 0 },
      label: {
        borderColor: "transparent",
        style: {
          background: "transparent",
          color: "#000",
          fontSize: "14px",
          fontWeight: "bold",
          padding: "0",
        },
        text: labels[i] || (i + 1).toString(),
        cssClass: "annotation-vertical period-label",
      },
    });

    // 分隔線（最後一條不要）
    if (i < sections - 1) {
      let lineIndex = window.tradingDates.findIndex(
        (d) => new Date(d).getTime() >= sectionEnd.getTime()
      );
      if (lineIndex !== -1 && lineIndex < window.tradingDates.length) {
        xaxisAnnotations.push({
          x: window.tradingDates[lineIndex],
          borderColor: "#999",
          strokeDashArray: 4,
          cssClass: "period-separator",
        });
      }
    }
  }

  const existing = chart.w.config.annotations || {};
  const existingXaxis = Array.isArray(existing.xaxis) ? existing.xaxis : [];
  const existingPoints = Array.isArray(existing.points) ? existing.points : [];

  // 保留非 period 的 points
  const preservedPoints = existingPoints.filter((p) => {
    if (!p || !p.label) return true;
    const css = p.label.cssClass || "";
    return !css.includes("period-label");
  });

  // 保留非 period 的 xaxis
  const preservedXaxis = existingXaxis.filter((x) => {
    const css = x.cssClass || "";
    return !css.includes("period-separator");
  });

  chart.clearAnnotations();
  pointAnnotations.forEach((p) => chart.addPointAnnotation(p));
  xaxisAnnotations.forEach((x) => chart.addXaxisAnnotation(x));
}

let currentMonths = 3; // 紀錄目前選擇的月份
let showPeriods = false; // 是否顯示時間區隔

function togglePeriods() {
  showPeriods = !showPeriods; // 每按一次切換 true/false

  const btn = document.getElementById("togglePeriodsBtn");
  if (btn) {
    btn.classList.toggle("active", showPeriods);
    btn.textContent = showPeriods ? "關閉區隔" : "顯示區隔";
  }

  if (!chart) return;

  if (showPeriods) {
    addPeriodSeparators(currentMonths); // 打開 → 畫出分隔線
  } else {
    chart.clearAnnotations(); // 關掉 → 清掉分隔線（之後有需要可以再優化保留條件標註）
  }
}

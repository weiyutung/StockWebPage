console.log("app_new");

// 後端 FastAPI 反向代理的前綴；用同源更簡單
const API_BASE = "/api";
const menuContainer = document.getElementById("menuContainer");
const dropdownMenu = document.getElementById("dropdownMenu");

window.priceChartInst = null;
window.volumeChartInst = null;
window.conditionAnnoIds = []; //  用來記錄條件點的 annotation id

let future30Added = false;
let originalTradingDates = null;
let futurePredictionSeries = null;
let originalZoomRange = null; //  記住原本 zoom 範圍

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

// ===== 時間區隔狀態 =====
let currentMonths = 3; // 目前的時間區隔長度（幾個月）
let showPeriods = false; // 是否顯示時間區隔線

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
  // 1. 先記住目前使用者勾選了哪些技術線和條件
  const checkedIndicatorsBefore = getCheckedIndicators();
  const builderStateBefore = getBuilderState(); // ★ 新增

  // 自訂日期區塊
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

    // ★ 加了 await：確保圖表畫完，才執行下面的還原動作
    await displayStockData(data, symbol);

    restoreCheckedIndicators(checkedIndicatorsBefore);
    applyIndicators();

    restoreBuilderState(builderStateBefore); // ★ 還原條件句
    applyConditionBuilder(true); // ★ 自動套用時靜音
    return;
  }

  // 快捷區間邏輯
  const rangeToCount = {
    "5d": 5,
    "1m": 22,
    "3m": 66,
    "6m": 132,
    "1y": 264,
    "3y": 792,
  };
  let count = rangeToCount[range] || 264;

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

  // ★ 加了 await：這行最重要，等圖表建立好 global chart 變數後，才能畫線
  await displayStockData(data, symbol);

  // 還原使用者勾選與條件標註
  restoreCheckedIndicators(checkedIndicatorsBefore);
  applyIndicators();

  restoreBuilderState(builderStateBefore); // ★
  applyConditionBuilder(true); // ★ 同樣靜音

  console.log("symbol:", symbol, "count:", count);
}

async function displayStockData(data, symbol) {
  window.stockData = data;

  // X 軸交易日
  window.tradingDates = data.map((row) => {
    const d = new Date(row.date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // 上圖：K線資料
  const chartData = data.map((row, idx) => ({
    x: window.tradingDates[idx],
    y: [+row.open, +row.high, +row.low, +row.close],
  }));

  // 下圖：成交量資料
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

  document.getElementById("chartTitle").innerText = `${symbol}`;
  document.getElementById("ohlcInfo").innerHTML =
    "將滑鼠懸停在圖表上以查看詳細資訊";

  // 清除舊圖表
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

  const GRID_PAD_PRICE = { top: 0, right: 0, bottom: -5, left: 16 };
  const GRID_PAD_VOLUME = { top: -20, right: -25, bottom: 0, left: 28 };

  // ===== 上方「價格＋技術線」圖 =====
  const optionsPrice = {
    chart: {
      id: "pricePane",
      group: "stockPane",
      type: "candlestick",
      height: 370,
      zoom: { enabled: true, type: "x", autoScaleYaxis: false },
      events: {
        mounted: function () {
          ensureVolumeAxis();
        },
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
                { ...chart.w.config.yaxis[0], show: true },
                { ...chart.w.config.yaxis[1], show: showMacd },
                { ...chart.w.config.yaxis[2], show: showKdj },
                { ...chart.w.config.yaxis[3], show: showBias },
              ],
            },
            false,
            false
          );
          ensureVolumeAxis();
        },
      },
    },
    legend: { show: false },
    grid: { padding: GRID_PAD_PRICE },
    plotOptions: {
      candlestick: { colors: { upward: "#e74c3c", downward: "#2ecc71" } },
      bar: { columnWidth: "70%" },
    },
    states: {
      hover: { filter: { type: "darken", value: 0.7 } },
      active: { filter: { type: "darken", value: 1.5 } },
    },
    xaxis: buildSharedXAxis(),
    yaxis: [
      {
        title: { text: "價格 / SMA" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        tickAmount: 4,
        opposite: false,
        show: true,
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
        title: { text: "MACD" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["DIF", "DEA"],
      },
      {
        title: { text: "KDJ" },
        labels: { formatter: (v) => Number(v.toFixed(0)) },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["K", "D", "J"],
      },
      {
        title: { text: "Bias" },
        labels: { formatter: (v) => Number(v.toFixed(2)) },
        opposite: true,
        show: false,
        seriesName: ["Bias"],
      },
    ],
    series: [{ name: "K線圖", type: "candlestick", data: chartData }],
    tooltip: {
      shared: true,
      custom: function ({ series, dataPointIndex, w }) {
        const ohlc = w.globals.initialSeries[0].data[dataPointIndex].y;
        const date = window.tradingDates[dataPointIndex];
        const trendClass = ohlc[3] >= ohlc[0] ? "up" : "down";
        const volRaw = window.stockData?.[dataPointIndex]?.volume ?? null;
        function fmtVol(val) {
          if (val == null) return "";
          if (val >= 1e9) return (val / 1e9).toFixed(0) + "B";
          if (val >= 1e6) return (val / 1e6).toFixed(0) + "M";
          if (val >= 1e3) return (val / 1e3).toFixed(0) + "K";
          return String(val);
        }
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
        const info = document.getElementById("ohlcInfo");
        if (info) {
          info.innerHTML = `
            <span class="ohlc-item"><span class="ohlc-label">開</span><span class="ohlc-value ${trendClass}">${ohlc[0].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">高</span><span class="ohlc-value ${trendClass}">${ohlc[1].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">低</span><span class="ohlc-value ${trendClass}">${ohlc[2].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">收</span><span class="ohlc-value ${trendClass}">${ohlc[3].toFixed(
            2
          )}</span></span>
          `;
        }
        return `<div style="background:rgba(255,255,255,0.85); padding:8px; border-radius:6px; font-size:13px;">
            <div style="font-weight:bold; margin-bottom:4px;">${date}</div>
            <div style="color:#555;">成交量: ${fmtVol(
              volRaw
            )}</div>${techLinesHtml}</div>`;
      },
    },
  };

  // ===== 下方「成交量」圖 =====
  const optionsVolume = {
    chart: {
      id: "volumePane",
      group: "stockPane",
      type: "bar",
      parentHeightOffset: 0,
      height: 130,
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    plotOptions: { bar: { columnWidth: "70%", borderRadius: 2 } },
    stroke: { width: 0 },
    grid: { padding: GRID_PAD_VOLUME },
    xaxis: buildSharedXAxis(),
    yaxis: makeVolumeYAxis(),
    dataLabels: { enabled: false },
    tooltip: {
      enabled: true,
      shared: false,
      intersect: true,
      custom: () => "",
    },
    states: {
      normal: { filter: { type: "none", value: 0 } },
      hover: { filter: { type: "darken", value: 0.55 } },
      active: { filter: { type: "darken", value: 0.55 } },
    },
    series: [{ name: "Volume", type: "bar", data: volData }],
  };

  window.priceChartInst = new ApexCharts(
    document.querySelector("#priceChart"),
    optionsPrice
  );
  window.volumeChartInst = new ApexCharts(
    document.querySelector("#volumeChart"),
    optionsVolume
  );

  // Render 並等待完成
  await Promise.all([
    window.priceChartInst.render(),
    window.volumeChartInst.render(),
  ]);

  chart = window.priceChartInst;
  syncXAxes();
  ensureVolumeAxis();

  // 技術指標更新邏輯
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

  // window.updateIndicatorsFromChecked = () => {
  //   const checked = Array.from(
  //     document.querySelectorAll(".indicator-check:checked")
  //   ).map((cb) => cb.value);
  //   const range = getCurrentXRange();
  //   let newSeries = [{ name: "K線圖", type: "candlestick", data: chartData }];

  //   // 1. 判斷哪些右側指標被勾選
  //   const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
  //   const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
  //   const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

  //   // 2. 計算右側多了幾個 Y 軸 (每個軸會佔用寬度，導致上圖往左縮)
  //   let rightAxisCount = 0;
  //   if (showMacd) rightAxisCount++;
  //   if (showKdj) rightAxisCount++;
  //   if (showBias) rightAxisCount++;

  //   // 3. 動態計算下圖 (Volume) 需要的右邊距
  //   // 基礎值 -25 (這是你原本設定的無軸時對齊值)
  //   // 每個 Y 軸大約佔用 55px (這個數值可根據字體大小微調)
  //   const axisWidth = 55;
  //   const baseVolRightPad = -25;
  //   const newVolRightPad = baseVolRightPad + rightAxisCount * axisWidth;

  //   // 4. 準備數據 Series
  //   checked.forEach((name) => {
  //     const field = indicatorFieldMap[name];
  //     if (!field) return;
  //     const dataSeries = window.stockData.map((row, idx) => ({
  //       x: window.tradingDates[idx],
  //       y: row[field] != null ? parseFloat(row[field]) : null,
  //     }));
  //     let yAxisIndex = 0;
  //     if (indicatorGroups.macd.includes(name)) yAxisIndex = 1;
  //     else if (indicatorGroups.kdj.includes(name)) yAxisIndex = 2;
  //     else if (indicatorGroups.bias.includes(name)) yAxisIndex = 3;

  //     newSeries.push({
  //       name,
  //       type: "line",
  //       data: dataSeries,
  //       yAxisIndex,
  //       color: indicatorColors[name] || "#000",
  //     });
  //   });

  //   // 5. 更新上圖 (Price Chart)
  //   chart.updateSeries(newSeries, false);
  //   chart.updateOptions(
  //     {
  //       yaxis: [
  //         { ...chart.w.config.yaxis[0], show: true },
  //         { ...chart.w.config.yaxis[1], show: showMacd },
  //         { ...chart.w.config.yaxis[2], show: showKdj },
  //         { ...chart.w.config.yaxis[3], show: showBias },
  //       ],
  //     },
  //     false,
  //     false
  //   );

  //   // 6. ★ 更新下圖 (Volume Chart) 的 Padding 以對齊上圖
  //   ApexCharts.exec(
  //     "volumePane",
  //     "updateOptions",
  //     {
  //       grid: {
  //         padding: {
  //           left: 28, // 保持原本的左邊距
  //           right: newVolRightPad, // 套用動態計算的右邊距
  //         },
  //       },
  //       yaxis: makeVolumeYAxis(),
  //     },
  //     false,
  //     false
  //   );

  //   restoreXRange(range);
  // };

  window.updateIndicatorsFromChecked = () => {
    const checked = Array.from(
      document.querySelectorAll(".indicator-check:checked")
    ).map((cb) => cb.value);
    const range = getCurrentXRange();
    let newSeries = [{ name: "K線圖", type: "candlestick", data: chartData }];

    // 1. 判斷哪些右側指標被勾選
    const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
    const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
    const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

    // 2. 計算右側多了幾個 Y 軸 (每個軸會佔用寬度，導致上圖往左縮)
    let rightAxisCount = 0;
    if (showMacd) rightAxisCount++;
    if (showKdj) rightAxisCount++;
    if (showBias) rightAxisCount++;

    const axisWidth = 55;
    const baseVolRightPad = -25;
    const newVolRightPad = baseVolRightPad + rightAxisCount * axisWidth;

    // 3. 準備數據 Series（技術線）
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

    // ★ 4. 如果有「未來30天預測」的 series，把它也加進來
    if (future30Added && futurePredictionSeries) {
      newSeries.push(futurePredictionSeries);
    }

    // 5. 更新上圖 (Price Chart)
    chart.updateSeries(newSeries, false);
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

    // 6. ★ 更新下圖 Volume 的 Padding
    ApexCharts.exec(
      "volumePane",
      "updateOptions",
      {
        grid: {
          padding: {
            left: 28,
            right: newVolRightPad,
          },
        },
        yaxis: makeVolumeYAxis(),
      },
      false,
      false
    );

    restoreXRange(range);
  };

  document.querySelectorAll(".indicator-check").forEach((checkbox) => {
    checkbox.onchange = window.updateIndicatorsFromChecked;
  });

  if (showPeriods) addPeriodSeparators(currentMonths);
}

// === 產生未來 30 天，並把它加到 X 軸 ===
// function appendFuture30Days() {
//     if (!window.tradingDates || window.tradingDates.length === 0) return;

//     //  記住目前的 zoom 範圍（minIndex / maxIndex）
//     const range = getCurrentXRange(); // {min, max}

//     const last = window.tradingDates.at(-1);
//     const base = new Date(last);

//     const future = [];
//     for (let i = 1; i <= 30; i++) {
//       const d = new Date(base);
//       d.setDate(base.getDate() + i);
//       future.push(
//         `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//           2,
//           "0"
//         )}-${String(d.getDate()).padStart(2, "0")}`
//       );
//     }

//     // 更新 categories
//     window.tradingDates.push(...future);

//   // 重新設定 X 軸（上下圖）
//   ApexCharts.exec(
//     "pricePane",
//     "updateOptions",
//     { xaxis: buildSharedXAxis() },
//     false,
//     true
//   );
//   ApexCharts.exec(
//     "volumePane",
//     "updateOptions",
//     { xaxis: buildSharedXAxis() },
//     false,
//     true
//   );

//   // 重新同步（但不會 override）
//   syncXAxes();

//   // 套回 zoom，右邊往後推 30 天
//   if (range) {
//     ApexCharts.exec("pricePane", "zoomX", range.min, range.max + 30);
//     ApexCharts.exec("volumePane", "zoomX", range.min, range.max + 30);
//   }

//   console.log("已加入未來 30 天", future);
// }

// ApexCharts.exec(
//   "pricePane",
//   "updateOptions",
//   {
//     xaxis: buildSharedXAxis(),
//   },
//   false,
//   true
// );

// ApexCharts.exec(
//   "volumePane",
//   "updateOptions",
//   {
//     xaxis: buildSharedXAxis(),
//   },
//   false,
//   true
// );

// function toggleFuture30Days() {
//   const futureBtn = document.getElementById("future30Btn");

//   // 第一次按 → 加 30 天
//   if (!future30Added) {
//     if (!window.tradingDates || window.tradingDates.length === 0) return;

//     // 存一次原本的日期（用來還原）
//     originalTradingDates = [...window.tradingDates];

//     //  記住目前的 zoom 範圍（minIndex / maxIndex）
//     const range = getCurrentXRange();

//     const last = window.tradingDates.at(-1);
//     const base = new Date(last);

//     const future = [];
//     for (let i = 1; i <= 30; i++) {
//       const d = new Date(base);
//       d.setDate(base.getDate() + i);
//       future.push(
//         `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//           2,
//           "0"
//         )}-${String(d.getDate()).padStart(2, "0")}`
//       );
//     }

//     // 加入未來 30 天
//     window.tradingDates.push(...future);

//     // 上下圖更新 x 軸
//     ApexCharts.exec(
//       "pricePane",
//       "updateOptions",
//       { xaxis: buildSharedXAxis() },
//       false,
//       true
//     );
//     ApexCharts.exec(
//       "volumePane",
//       "updateOptions",
//       { xaxis: buildSharedXAxis() },
//       false,
//       true
//     );

//     // 同步上下圖
//     syncXAxes();

//     // 套回 zoom，右邊往後推 30 天
//     if (range) {
//       ApexCharts.exec("pricePane", "zoomX", range.min, range.max + 30);
//       ApexCharts.exec("volumePane", "zoomX", range.min, range.max + 30);
//     }

//     future30Added = true;
//     futureBtn.textContent = "移除未來30天";
//     futureBtn.classList.add("active");

//     console.log("已加入未來 30 天", future);
//     return;
//   }

//   // 第二次按 → 移除未來 30 天（恢復原本）
//   if (future30Added && originalTradingDates) {
//     // 還原交易日
//     window.tradingDates = [...originalTradingDates];

//     // 重設 X 軸
//     ApexCharts.exec(
//       "pricePane",
//       "updateOptions",
//       { xaxis: buildSharedXAxis() },
//       false,
//       true
//     );
//     ApexCharts.exec(
//       "volumePane",
//       "updateOptions",
//       { xaxis: buildSharedXAxis() },
//       false,
//       true
//     );

//     syncXAxes();

//     future30Added = false;
//     futureBtn.textContent = "加入未來30天";
//     futureBtn.classList.remove("active");

//     console.log("已移除未來 30 天");
//   }
// }

// function toggleFuture30Days() {
//   const futureBtn = document.getElementById("future30Btn");

//   // ==========================
//   // 第一次按 → 加入未來 30 天
//   // ==========================
//   if (!future30Added) {
//     if (!window.tradingDates || window.tradingDates.length === 0) return;

//     // 記住原本日期與 zoom（只記一次）
//     originalTradingDates = [...window.tradingDates];
//     originalZoomRange = getCurrentXRange();

//     const last = window.tradingDates.at(-1);
//     const base = new Date(last);

//     const future = [];
//     for (let i = 1; i <= 30; i++) {
//       const d = new Date(base);
//       d.setDate(base.getDate() + i);
//       future.push(
//         `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//           2,
//           "0"
//         )}-${String(d.getDate()).padStart(2, "0")}`
//       );
//     }

//     // 加入未來日期
//     window.tradingDates.push(...future);

//     // 更新 X 軸
//     ApexCharts.exec("pricePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });
//     ApexCharts.exec("volumePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });

//     syncXAxes();

//     // 套回原 zoom，但右側擴大 30 天
//     if (originalZoomRange) {
//       ApexCharts.exec(
//         "pricePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//       ApexCharts.exec(
//         "volumePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//     }

//     future30Added = true;
//     futureBtn.textContent = "移除未來30天";
//     futureBtn.classList.add("active");

//     console.log("✔ 已加入未來 30 天");
//     return;
//   }

//   // ==========================
//   // 第二次按 → 移除恢復原本
//   // ==========================
//   if (future30Added && originalTradingDates) {
//     window.tradingDates = [...originalTradingDates];

//     // 更新 X 軸
//     ApexCharts.exec("pricePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });
//     ApexCharts.exec("volumePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });

//     syncXAxes();

//     // 恢復原本 zoom 範圍
//     if (originalZoomRange) {
//       ApexCharts.exec(
//         "pricePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max
//       );
//       ApexCharts.exec(
//         "volumePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max
//       );
//     }

//     future30Added = false;
//     futureBtn.textContent = "加入未來30天";
//     futureBtn.classList.remove("active");

//     console.log("✔ 已移除未來 30 天（恢復原本）");
//     return;
//   }
// }

// async function toggleFuture30Days() {
//   const futureBtn = document.getElementById("future30Btn");

//   // 第一次按 → 加未來30天 + 畫預測柱狀圖
//   if (!future30Added) {
//     const symbol = getSymbol();

//     //  先向後端取得預測資料
//     const resp = await fetch(`${API_BASE}/prediction?symbol=${symbol}`);
//     if (!resp.ok) {
//       alert("取得預測資料失敗");
//       return;
//     }
//     const pred = await resp.json();

//     // pred.pred_json        → 方向 ["up","down","flat"...]
//     // pred.cumulative_json  → 分數 [1,2,2,-1,...]
//     const directions = JSON.parse(pred.pred_json);
//     const scores = JSON.parse(pred.cumulative_json);
//     const baseClose = pred.base_close;

//     // 記住原本日期與 zoom
//     originalTradingDates = [...window.tradingDates];
//     originalZoomRange = getCurrentXRange();

//     const last = window.tradingDates.at(-1);
//     const baseDate = new Date(last);

//     // 產生未來 30 天日期
//     const futureDates = [];
//     for (let i = 1; i <= 30; i++) {
//       const d = new Date(baseDate);
//       d.setDate(baseDate.getDate() + i);
//       futureDates.push(
//         `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//           2,
//           "0"
//         )}-${String(d.getDate()).padStart(2, "0")}`
//       );
//     }

//     // 加進 X 軸
//     window.tradingDates.push(...futureDates);

//     // 更新上下圖
//     ApexCharts.exec("pricePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });
//     ApexCharts.exec("volumePane", "updateOptions", {
//       xaxis: buildSharedXAxis(),
//     });
//     syncXAxes();

//     // 利用你的 buildFuture30Series 計算預測收盤價
//     const predictionSeries = buildFuture30Series(
//       baseClose,
//       directions,
//       scores,
//       futureDates
//     );

//     //  把預測柱狀圖加入 K 線圖
//     applyFuture30Series(predictionSeries);

//     // 原本 zoom → 右邊多30天
//     if (originalZoomRange) {
//       ApexCharts.exec(
//         "pricePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//       ApexCharts.exec(
//         "volumePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//     }

//     future30Added = true;
//     futureBtn.textContent = "移除未來30天";
//     futureBtn.classList.add("active");
//     console.log("已加入未來 30 天 & 預測柱");
//     return;
//   }

//   // 第二次按 → 恢復原本日期 + 移除預測柱
//   window.tradingDates = [...originalTradingDates];

//   ApexCharts.exec("pricePane", "updateOptions", { xaxis: buildSharedXAxis() });
//   ApexCharts.exec("volumePane", "updateOptions", { xaxis: buildSharedXAxis() });
//   syncXAxes();

//   if (originalZoomRange) {
//     ApexCharts.exec(
//       "pricePane",
//       "zoomX",
//       originalZoomRange.min,
//       originalZoomRange.max
//     );
//     ApexCharts.exec(
//       "volumePane",
//       "zoomX",
//       originalZoomRange.min,
//       originalZoomRange.max
//     );
//   }

//   // 移除預測柱狀圖
//   removeFuture30Series();

//   future30Added = false;
//   futureBtn.textContent = "加入未來30天";
//   futureBtn.classList.remove("active");

//   console.log(" 已移除未來30天 & 預測柱");
// }

// async function toggleFuture30Days() {
//   const futureBtn = document.getElementById("future30Btn");

//   // ========== 第一次按：加入未來 30 天 ==========
//   if (!future30Added) {
//     const symbol = getSymbol();

//     // 取得預測資料
//     const resp = await fetch(`${API_BASE}/prediction?symbol=${symbol}`);
//     if (!resp.ok) {
//       alert("預測資料取得失敗");
//       return;
//     }
//     const pred = await resp.json();

//     const directions = JSON.parse(pred.pred_json);
//     const scores = JSON.parse(pred.cumulative_json);
//     const baseClose = pred.base_close;

//     // 記住原來的日期
//     originalTradingDates = [...window.tradingDates];
//     originalZoomRange = getCurrentXRange();

//     // 產生 30 天未來日期
//     const last = new Date(window.tradingDates.at(-1));
//     const futureDates = [];
//     for (let i = 1; i <= 30; i++) {
//       const d = new Date(last);
//       d.setDate(last.getDate() + i);
//       futureDates.push(
//         `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//           2,
//           "0"
//         )}-${String(d.getDate()).padStart(2, "0")}`
//       );
//     }

//     // 🔥 1. 更新 global X 軸 categories
//     window.tradingDates = [...window.tradingDates, ...futureDates];

//     // 🔥 2. 更新上下圖的 X 軸
//     ApexCharts.exec(
//       "pricePane",
//       "updateOptions",
//       {
//         xaxis: buildSharedXAxis(),
//       },
//       false,
//       true
//     );

//     ApexCharts.exec(
//       "volumePane",
//       "updateOptions",
//       {
//         xaxis: buildSharedXAxis(),
//       },
//       false,
//       true
//     );

//     syncXAxes();

//     // 🔥 3. 計算預測柱狀圖
//     const predictionSeries = buildFuture30Series(
//       baseClose,
//       directions,
//       scores,
//       futureDates
//     );

//     // 🔥 4. 加入預測柱
//     applyFuture30Series(predictionSeries);

//     // 🔥 5. 原 zoom 範圍往右擴 30 天
//     if (originalZoomRange) {
//       ApexCharts.exec(
//         "pricePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//       ApexCharts.exec(
//         "volumePane",
//         "zoomX",
//         originalZoomRange.min,
//         originalZoomRange.max + 30
//       );
//     }

//     future30Added = true;
//     futureBtn.textContent = "移除未來30天";
//     futureBtn.classList.add("active");
//     return;
//   }

//   // ========== 第二次按：移除 ==========
//   window.tradingDates = [...originalTradingDates];

//   ApexCharts.exec(
//     "pricePane",
//     "updateOptions",
//     {
//       xaxis: buildSharedXAxis(),
//     },
//     false,
//     true
//   );

//   ApexCharts.exec(
//     "volumePane",
//     "updateOptions",
//     {
//       xaxis: buildSharedXAxis(),
//     },
//     false,
//     true
//   );

//   syncXAxes();

//   if (originalZoomRange) {
//     ApexCharts.exec(
//       "pricePane",
//       "zoomX",
//       originalZoomRange.min,
//       originalZoomRange.max
//     );
//     ApexCharts.exec(
//       "volumePane",
//       "zoomX",
//       originalZoomRange.min,
//       originalZoomRange.max
//     );
//   }

//   removeFuture30Series();

//   future30Added = false;
//   futureBtn.textContent = "加入未來30天";
//   futureBtn.classList.remove("active");
// }

async function toggleFuture30Days() {
  const futureBtn = document.getElementById("future30Btn");

  // ========== 第一次按：加入未來 30 天 ==========
  if (!future30Added) {
    if (!window.stockData || !window.tradingDates || !window.stockData.length) {
      alert("請先載入股票歷史資料");
      return;
    }

    const symbol = getSymbol();
    const resp = await fetch(
      `${API_BASE}/prediction?symbol=${encodeURIComponent(symbol)}`
    );
    if (!resp.ok) {
      alert("預測資料取得失敗");
      return;
    }
    const raw = await resp.text();

    let pred;
    try {
      pred = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("預測 API 回傳的不是合法 JSON：", e);
      alert("預測 API 回傳的不是合法 JSON，請先檢查後端回傳格式。");
      return;
    }

    const predictions = pred?.predictions || [];

    if (!predictions.length) {
      alert("此股票目前沒有未來30天預測資料");
      return;
    }

    // 記住原本的日期 & zoom 範圍
    originalTradingDates = [...window.tradingDates];
    originalZoomRange = getCurrentXRange();

    // 後端已經給好未來 30 天的日期，直接接在 X 軸後面
    const futureDates = predictions.map((p) => p.date);
    window.tradingDates = [...window.tradingDates, ...futureDates];

    // 更新上下圖 X 軸
    ApexCharts.exec(
      "pricePane",
      "updateOptions",
      { xaxis: buildSharedXAxis() },
      false,
      true
    );
    ApexCharts.exec(
      "volumePane",
      "updateOptions",
      { xaxis: buildSharedXAxis() },
      false,
      true
    );
    syncXAxes();

    // baseClose：用當前最後一根 K 線的收盤價
    const lastRow = window.stockData[window.stockData.length - 1];
    const baseClose = parseFloat(lastRow.close);
    const series = buildFuture30SeriesFromDir(predictions, baseClose);
    if (series) {
      futurePredictionSeries = series;
      future30Added = true;

      // 交給 updateIndicatorsFromChecked 統一重畫（會把預測柱狀圖一起加進去）
      if (typeof window.updateIndicatorsFromChecked === "function") {
        window.updateIndicatorsFromChecked();
      }
    }

    // 把原本視窗向右多開 30 根
    if (originalZoomRange) {
      const extra = futureDates.length;
      ApexCharts.exec(
        "pricePane",
        "zoomX",
        originalZoomRange.min,
        originalZoomRange.max + extra
      );
      ApexCharts.exec(
        "volumePane",
        "zoomX",
        originalZoomRange.min,
        originalZoomRange.max + extra
      );
    }

    futureBtn.textContent = "移除未來30天";
    futureBtn.classList.add("active");
    console.log("✔ 已加入未來30天預測柱狀圖");
    return;
  }

  // ========== 第二次按：移除未來 30 天 ==========
  // 還原原本的 X 軸日期
  if (originalTradingDates) {
    window.tradingDates = [...originalTradingDates];
  }

  ApexCharts.exec(
    "pricePane",
    "updateOptions",
    { xaxis: buildSharedXAxis() },
    false,
    true
  );
  ApexCharts.exec(
    "volumePane",
    "updateOptions",
    { xaxis: buildSharedXAxis() },
    false,
    true
  );
  syncXAxes();

  // 還原原本 zoom 範圍
  if (originalZoomRange) {
    ApexCharts.exec(
      "pricePane",
      "zoomX",
      originalZoomRange.min,
      originalZoomRange.max
    );
    ApexCharts.exec(
      "volumePane",
      "zoomX",
      originalZoomRange.min,
      originalZoomRange.max
    );
  }

  // 把預測 series 拿掉，並重畫一次
  futurePredictionSeries = null;
  future30Added = false;
  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }

  futureBtn.textContent = "加入未來30天";
  futureBtn.classList.remove("active");
  console.log("已移除未來30天預測柱狀圖");
}

// 用後端回來的 predictions （date + dir）＋ baseClose
// 產生一個「未來30天預測柱狀圖」的 candlestick series
function buildFuture30SeriesFromDir(predictions, baseClose) {
  if (!predictions || !predictions.length || !baseClose) return null;

  // 每一個「累積分數」讓價位動 0.8%（你可以自己調）
  const step = baseClose * 0.008;
  let score = 0;

  const data = predictions.map((p) => {
    let delta = 0;
    if (p.dir === "up") delta = 1;
    else if (p.dir === "down") delta = -1;
    // flat 就是 0

    score += delta; // 累加

    // 以最後一根收盤價附近當中心往上/下抖動，畫成一根細蠟燭柱
    const center = baseClose + score * step;
    const high = center + step * 0.6;
    const low = center - step * 0.6;

    return {
      x: p.date, // 直接用後端給的日期字串
      y: [center, high, low, center], // [open, high, low, close]
    };
  });

  return {
    name: "未來30天預測",
    type: "candlestick", // 看起來就是一根一根柱狀圖
    data,
  };
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
    tickAmount: Math.min(getTickAmountByMonths(), cats.length - 1),
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
  const base = buildSharedXAxis(); // mm/dd formatter 版

  // 成交量圖完整顯示
  const volumeXAxis = base;

  // 價格圖只改 show，不改 tickAmount / labels / formatter
  const priceXAxis = {
    ...base,
    labels: {
      ...base.labels,
      show: false,
    },
    axisTicks: {
      ...base.axisTicks,
      show: false,
    },
  };

  ApexCharts.exec("pricePane", "updateOptions", { xaxis: priceXAxis });
  ApexCharts.exec("volumePane", "updateOptions", { xaxis: volumeXAxis });
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
    }
    // ensureVolumeAxis / syncXAxes 已在 displayStockData render 完後呼叫
  });
}

// ====== 時間區隔線：畫 Q1/Q2 或 1/2/3... 區塊 ======
// 根據 periodMonths，畫出時間區隔（會保留既有條件標記）
function addPeriodSeparators(periodMonths) {
  if (!chart || !window.stockData || !window.tradingDates) return;

  const { points, xaxis } = getPeriodAnnotations(periodMonths);

  // 先把既有 annotations 裡的「條件點」保留下來，只替換區隔相關的
  const existing = chart.w.config.annotations || {};
  const existingPoints = Array.isArray(existing.points) ? existing.points : [];

  const conditionPoints = existingPoints.filter(
    (p) => !p.label?.cssClass?.includes("period-label")
  );

  chart.updateOptions({
    annotations: {
      xaxis, // 新的區隔線
      points: [...conditionPoints, ...points], // 舊的條件點 + 新的區隔標籤
    },
  });
}

// 顯示 / 關閉「時間區隔」的按鈕（HTML: onclick="togglePeriods()"）
function togglePeriods() {
  showPeriods = !showPeriods;

  const btn = document.getElementById("togglePeriodsBtn");
  if (btn) {
    btn.classList.toggle("active", showPeriods);
    btn.textContent = showPeriods ? "關閉區隔" : "顯示區隔";
  }

  if (!chart) return;

  if (showPeriods) {
    // 打開 → 依照 currentMonths 把區隔線畫出來
    addPeriodSeparators(currentMonths);
  } else {
    // 關閉 → 把 period 的標註拿掉，但保留條件倒三角
    const existing = chart.w.config.annotations || {};
    const existingPoints = Array.isArray(existing.points)
      ? existing.points
      : [];
    const existingXaxis = Array.isArray(existing.xaxis) ? existing.xaxis : [];

    const preservedPoints = existingPoints.filter((p) => {
      const css = p.label?.cssClass || "";
      return !css.includes("period-label");
    });

    const preservedXaxis = existingXaxis.filter((x) => {
      const css = x.cssClass || "";
      return !css.includes("period-separator");
    });

    chart.updateOptions({
      annotations: {
        xaxis: preservedXaxis,
        points: preservedPoints,
      },
    });
  }
}

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

// =============================
// 進階條件拖曳式 Builder
// =============================

// 所有條件句都放在這個陣列裡
let conditionRows = [];
let conditionRowIdSeq = 1;

function createEmptyConditionRow() {
  return {
    id: conditionRowIdSeq++,
    left: null, // { field: "Sma_5", label: "SMA 5" }
    operator: ">", // ">", "<", ">=", "<=", "crossAbove", "crossBelow"
    right: null, // { field, label } 或 null
    numberValue: null, // 若 right 沒有指標，就用這個數值
  };
}

// 取目前 builder 狀態（換時間區間時暫存用）
// 取目前 builder 狀態（換時間區間時暫存用）
function getBuilderState() {
  return conditionRows.map((r) => ({
    id: r.id,
    left: r.left ? { ...r.left } : null,
    operator: r.operator,
    right: r.right ? { ...r.right } : null,
    numberValue: r.numberValue,
  }));
}

// 還原 builder 狀態並重畫 UI
function restoreBuilderState(rows) {
  if (Array.isArray(rows) && rows.length > 0) {
    conditionRows = rows.map((r) => ({ ...r }));
    const ids = conditionRows.map((r) => r.id);
    conditionRowIdSeq = (ids.length ? Math.max(...ids) : 0) + 1;
  } else {
    conditionRows = [createEmptyConditionRow()];
  }
  renderConditionRows();
}

// 把 conditionRows 畫到右邊的 #conditionRowsContainer
function renderConditionRows() {
  const container = document.getElementById("conditionRowsContainer");
  if (!container) return;

  container.innerHTML = "";

  conditionRows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "rule-row";
    rowEl.dataset.id = String(row.id);

    const leftLabel = row.left?.label || "指標 A";
    const rightLabel = row.right?.label || "指標 / 數值";

    rowEl.innerHTML = `
      <div class="drop-slot ${row.left ? "filled" : ""}" data-side="left">
        ${leftLabel}
      </div>
      <select class="op-select">
        <option value=">">&gt;</option>
        <option value="<">&lt;</option>
        <option value=">=">&gt;=</option>
        <option value="<=">&lt;=</option>
        <option value="crossAbove">上穿</option>
        <option value="crossBelow">下穿</option>
      </select>
      <div class="drop-slot ${row.right ? "filled" : ""}" data-side="right">
        ${rightLabel}
      </div>
      <input type="number" class="value-input" placeholder="或輸入數值" />
      <button type="button" class="delete-row-btn" title="刪除此條件">✕</button>
    `;

    // 運算子
    const opSelect = rowEl.querySelector(".op-select");
    opSelect.value = row.operator || ">";
    opSelect.addEventListener("change", () => {
      row.operator = opSelect.value;
    });

    // 數值輸入
    const valueInput = rowEl.querySelector(".value-input");
    if (
      row.right == null &&
      typeof row.numberValue === "number" &&
      !Number.isNaN(row.numberValue)
    ) {
      valueInput.value = row.numberValue;
    }
    valueInput.addEventListener("input", () => {
      const v = valueInput.value;
      row.numberValue = v === "" ? null : parseFloat(v);
    });

    // 刪除這一行
    const delBtn = rowEl.querySelector(".delete-row-btn");
    delBtn.addEventListener("click", () => {
      conditionRows = conditionRows.filter((r) => r.id !== row.id);
      if (conditionRows.length === 0) {
        conditionRows.push(createEmptyConditionRow());
      }
      renderConditionRows();
    });

    container.appendChild(rowEl);
  });
}

// 初始化拖曳事件：chip 拖曳 + drop slot 接收
function initConditionDragAndDrop() {
  // 左邊指標 chip：dragstart
  document.querySelectorAll(".rule-chip").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      const payload = {
        type: chip.dataset.type || "indicator",
        field: chip.dataset.field,
        label: chip.textContent.trim(),
      };
      e.dataTransfer.setData("application/json", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    });
  });

  // drop-slot：用事件委派掛在 controlPanel 上
  const panel = document.getElementById("controlPanel");
  if (!panel) return;

  panel.addEventListener("dragover", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    slot.classList.add("drag-over");
  });

  panel.addEventListener("dragleave", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    slot.classList.remove("drag-over");
  });

  panel.addEventListener("drop", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    e.preventDefault();
    slot.classList.remove("drag-over");

    const json = e.dataTransfer.getData("application/json");
    if (!json) return;

    let data;
    try {
      data = JSON.parse(json);
    } catch {
      return;
    }
    if (!data.field) return;

    const rowEl = slot.closest(".rule-row");
    if (!rowEl) return;
    const rowId = Number(rowEl.dataset.id);
    const row = conditionRows.find((r) => r.id === rowId);
    if (!row) return;

    const side = slot.dataset.side; // "left" or "right"
    row[side] = { field: data.field, label: data.label };

    if (side === "right") {
      // 右邊放指標時，清掉數值
      row.numberValue = null;
      const valueInput = rowEl.querySelector(".value-input");
      if (valueInput) valueInput.value = "";
    }

    slot.textContent = data.label;
    slot.classList.add("filled");
  });
}

// 在第 i 根 K 線上，判斷「單一句」條件是否成立（簡化版）
function evaluateConditionRowAtIndex(row, i) {
  if (!window.stockData || !window.stockData[i]) return false;
  const rec = window.stockData[i];

  if (!row || !row.left || !row.left.field) return false;

  const leftVal = parseFloat(rec[row.left.field]);
  if (!Number.isFinite(leftVal)) return false;

  let rightVal = null;

  // 右邊可以是「指標」或「固定數值」
  if (row.right && row.right.field) {
    rightVal = parseFloat(rec[row.right.field]);
  } else if (
    typeof row.numberValue === "number" &&
    !Number.isNaN(row.numberValue)
  ) {
    rightVal = row.numberValue;
  } else {
    // 只有一邊有值 → 先不畫點
    return false;
  }

  if (!Number.isFinite(rightVal)) return false;

  const op = row.operator || ">";

  switch (op) {
    case ">":
      return leftVal > rightVal;
    case "<":
      return leftVal < rightVal;
    case ">=":
      return leftVal >= rightVal;
    case "<=":
      return leftVal <= rightVal;
    default:
      // 上穿 / 下穿 還沒真的做 → 先當「>」
      return leftVal > rightVal;
  }
}

// 套用條件：只看「第一條有左邊指標的句子」，畫出符合的點
// 套用條件：只看「第一條有左邊指標的句子」，畫出符合的點
// silent = true 時不跳出 alert，只安靜地處理
// 在 app.js 中找到 applyConditionBuilder 函式，並用以下內容完全覆蓋

// 套用進階條件：只看「第一條有左邊指標的句子」，畫出符合的點
// silent = true 的時候不要跳 alert（像是換時間區間自動重畫用）
function applyConditionBuilder(silent = false) {
  console.log("[applyConditionBuilder] start (simple)", conditionRows);

  if (!window.stockData || !window.tradingDates) {
    console.warn("stockData 或 tradingDates 還沒準備好");
    return;
  }

  // 目前只抓「第一條有左邊指標的條件」
  const activeRow = conditionRows.find((r) => r.left);

  // 先抓目前圖上的 annotations（主要是時間區隔線 Q1 / Q2）
  const currentAnno =
    (window.priceChartInst &&
      window.priceChartInst.w &&
      window.priceChartInst.w.config &&
      window.priceChartInst.w.config.annotations) ||
    {};

  const existingXaxis = currentAnno.xaxis || [];
  const existingPointsRaw = Array.isArray(currentAnno.points)
    ? currentAnno.points
    : [];

  // 保留「時間區隔」點（有 cssClass = period-label）
  const preservedPoints = existingPointsRaw.filter(
    (p) => p.label && p.label.cssClass === "period-label"
  );

  // 如果沒有任何條件，當成「清除進階條件」，只留下時間區隔
  if (!activeRow) {
    console.log("[applyConditionBuilder] no activeRow, clear condition points");
    ApexCharts.exec("pricePane", "updateOptions", {
      annotations: {
        xaxis: existingXaxis,
        points: preservedPoints,
      },
    });
    if (!silent) {
      alert("請至少設定一個條件：先把指標拖到左側欄位");
    }
    return;
  }

  const markers = [];

  // 逐根 K 棒檢查這個 activeRow 是否成立
  for (let i = 0; i < window.stockData.length; i++) {
    if (!evaluateConditionRowAtIndex(activeRow, i)) continue;

    const rec = window.stockData[i];
    const xCat = window.tradingDates[i]; // 我們的 X 軸是「字串類別」，直接用日期字串
    const low = parseFloat(rec.low);
    const close = parseFloat(rec.close);
    const yVal = Number.isFinite(low) ? low : close; // 或想用收盤價也可以

    // 組標籤文字：左指標 OP 右指標 / 數值
    let rightText = "";
    if (activeRow.right && activeRow.right.label) {
      rightText = activeRow.right.label;
    } else if (
      typeof activeRow.numberValue === "number" &&
      !Number.isNaN(activeRow.numberValue)
    ) {
      rightText = String(activeRow.numberValue);
    }

    const labelText = `${activeRow.left.label || activeRow.left.field} ${
      activeRow.operator || ">"
    } ${rightText}`;

    markers.push({
      x: xCat,
      y: yVal,
      marker: {
        size: 6,
        fillColor: "#e74c3c",
        strokeColor: "#ffffff",
        strokeWidth: 1,
        shape: "circle",
      },
      label: {
        text: labelText.trim(),
        borderColor: "#e74c3c",
        style: {
          fontSize: "11px",
          color: "#ffffff",
          background: "#e74c3c",
        },
      },
    });
  }

  console.log("[applyConditionBuilder] markers found:", markers.length);

  // 如果真的沒有任何符合條件的點，就在最後一根畫一個灰色提示點
  if (markers.length === 0 && window.stockData.length > 0) {
    const lastIdx = window.stockData.length - 1;
    const rec = window.stockData[lastIdx];
    const xCat = window.tradingDates[lastIdx];
    const low = parseFloat(rec.low);
    const close = parseFloat(rec.close);
    const yVal = Number.isFinite(low) ? low : close;

    markers.push({
      x: xCat,
      y: yVal,
      marker: {
        size: 6,
        fillColor: "#999999",
        strokeColor: "#ffffff",
        strokeWidth: 1,
        shape: "circle",
      },
      label: {
        text: "目前區間沒有符合條件的點",
        borderColor: "#999999",
        style: {
          fontSize: "11px",
          color: "#ffffff",
          background: "#999999",
        },
      },
    });
  }

  // 把「保留的時間區隔點」+「新的條件點」合在一起，一次更新到 pricePane
  const finalPoints = preservedPoints.concat(markers);

  ApexCharts.exec("pricePane", "updateOptions", {
    annotations: {
      xaxis: existingXaxis,
      points: finalPoints,
    },
  });

  console.log(
    "[applyConditionBuilder] applied points:",
    finalPoints.length,
    "(markers =",
    markers.length,
    ")"
  );
}

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
  if (window.flatpickr) {
    if (flatpickr.l10ns && flatpickr.l10ns.zh_tw) {
      flatpickr.localize(flatpickr.l10ns.zh_tw);
    }

    // 和 CSS 裡的 transform: scale(...) 保持一樣
    const CAL_SCALE = 0.85;

    const commonOptions = {
      dateFormat: "Y-m-d",
      maxDate: "today",
      allowInput: false,

      onOpen: function (selectedDates, dateStr, instance) {
        requestAnimationFrame(() => {
          const cal = instance.calendarContainer;
          const input = instance.input;
          if (!cal || !input) return;

          const inputRect = input.getBoundingClientRect();
          const calRect = cal.getBoundingClientRect();
          const margin = 8;

          let left;

          if (input.id === "customStart") {
            // 🔹開始日期：左邊對齊 input
            left = inputRect.left;
          } else {
            // 🔹結束日期：右邊對齊 input
            left = inputRect.right - calRect.width;
          }

          // 防止超出畫面
          if (left < margin) left = margin;
          if (left + calRect.width > window.innerWidth - margin) {
            left = window.innerWidth - calRect.width - margin;
          }

          cal.style.left = left + "px";
          cal.style.top = inputRect.bottom + 6 + "px"; // 接在 input 下方一點
        });
      },
    };

    // 開始／結束兩顆 input 都用同一組設定
    flatpickr("#customStart", commonOptions);
    flatpickr("#customEnd", commonOptions);
  }

  // 預設把 3m 的按鈕標成 active
  const defaultBtn = document.querySelector(
    ".time-range-item[onclick*=\"'3m'\"]"
  );
  if (defaultBtn) {
    defaultBtn.classList.add("active");
  }

  // === 進階條件 builder 初始化 ===
  restoreBuilderState([]); // 產生第一行空白條件
  initConditionDragAndDrop(); // 啟用拖曳

  const addBtn = document.getElementById("addConditionRowBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      conditionRows.push(createEmptyConditionRow());
      renderConditionRows();
    });
  }

  const applyBtn = document.getElementById("applyConditionsBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyConditionBuilder();
    });
  }

  const clearBtn = document.getElementById("clearConditionsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      conditionRows = [createEmptyConditionRow()];
      renderConditionRows();
      applyConditionBuilder(true); // 不跳 alert，只清掉條件點
    });
  }

  const futureBtn = document.getElementById("future30Btn");
  if (futureBtn) {
    futureBtn.addEventListener("click", toggleFuture30Days);
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

// ==========================================
// ★ 全新重寫：集中式標註管理系統 (解決衝突問題)
// ==========================================

// 1. 定義全域狀態 (Single Source of Truth)
window.appState = {
  rules: [], // 存放目前勾選的規則 (Array)
  showPeriods: false, // 是否顯示時間區隔 (Boolean)
  currentMonths: 3, // 目前的時間長度 (Number)
};

/**
 * 核心函式：計算並渲染所有標註
 * 無論是勾選規則、還是切換時間區隔，最後都呼叫這支函式
 */
function renderAllAnnotations() {
  if (!chart || !window.stockData || !window.tradingDates) return;

  // 1. 產生條件判斷的標註 (倒三角)
  const conditionAnnotations = getConditionAnnotations(window.appState.rules);

  // 2. 產生時間區隔的標註 (虛線 + Q1/Q2文字)
  const periodAnnotations = window.appState.showPeriods
    ? getPeriodAnnotations(window.appState.currentMonths)
    : { points: [], xaxis: [] };

  // 3. 合併所有標註
  const finalPoints = [...conditionAnnotations, ...periodAnnotations.points];
  const finalXaxis = [...periodAnnotations.xaxis];

  console.log(
    `🎨 [重繪] 條件點:${conditionAnnotations.length}, 區隔線:${finalXaxis.length}`
  );

  // 4. 一次性更新到圖表
  chart.updateOptions({
    annotations: {
      xaxis: finalXaxis,
      points: finalPoints,
    },
  });
}

/**
 * 產生條件標註陣列 (純計算，不操作圖表)
 */
function getConditionAnnotations(rules) {
  if (!rules || rules.length === 0) return [];
  let points = [];

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

  window.stockData.forEach((row, i) => {
    const prev = window.stockData[i - 1];
    const prev2 = window.stockData[i - 2];
    if (!prev || !prev2) return;

    // 數值準備
    const v = (r, k) => parseFloat(r[k]);
    const sma5 = v(row, "Sma_5"),
      sma20 = v(row, "Sma_20");
    const pSma5 = v(prev, "Sma_5"),
      pSma20 = v(prev, "Sma_20");
    const dif = v(row, "DIF"),
      dea = v(row, "DEA");
    const pDif = v(prev, "DIF"),
      pDea = v(prev, "DEA");
    const k = v(row, "K"),
      d = v(row, "D");
    const pK = v(prev, "K"),
      pD = v(prev, "D");
    const bias = v(row, "Bias");

    // 規則邏輯
    const checks = {
      "sma-cross": () => pSma5 < pSma20 && sma5 >= sma20,
      "dif-above-dea": () => pDif < pDea && dif >= dea,
      "dea-below-dif": () => pDea < pDif && dea >= dif,
      "kd-cross": () => pK < pD && k >= d && k < 20,
      "bias-high": () => bias > 5,
      "bias-low": () => bias < -5,
      "three-red": () =>
        [row, prev, prev2].every((r) => v(r, "close") > v(r, "open")),
      "three-down-volume": () =>
        row.volume < prev.volume && prev.volume < prev2.volume,
    };

    // 判斷是否符合
    let matchedText = "";
    if (rules.length === 1) {
      if (checks[rules[0]] && checks[rules[0]]())
        matchedText = labelMap[rules[0]];
    } else {
      const allPass = rules.every((r) => checks[r] && checks[r]());
      if (allPass) matchedText = rules.map((r) => labelMap[r]).join("");
    }

    // 建立標記
    if (matchedText) {
      points.push({
        x: window.tradingDates[i],
        y: parseFloat(row.low) * 0.98, // 最低價下方
        yAxisIndex: 0,
        marker: {
          size: 5,
          fillColor: "#000",
          strokeColor: "#000",
          shape: "triangle",
        },
        label: {
          borderColor: "transparent",
          offsetY: 30,
          style: {
            background: "transparent",
            color: "#000",
            fontSize: "12px",
            fontWeight: "bold",
          },
          text: matchedText,
        },
      });
    }
  });
  return points;
}

/**
 * 產生時間區隔標註 (純計算，不操作圖表)
 */
// 產生時間區隔標註 (純計算，不直接動圖表)
function getPeriodAnnotations(periodMonths) {
  if (!window.tradingDates || window.tradingDates.length === 0) {
    return { points: [], xaxis: [] };
  }
  if (periodMonths <= 1) {
    // 1 個月就不畫區隔
    return { points: [], xaxis: [] };
  }

  const startDate = new Date(window.tradingDates[0]);
  const endDate = new Date(window.tradingDates[window.tradingDates.length - 1]);
  const totalMs = endDate - startDate;
  if (totalMs <= 0) {
    return { points: [], xaxis: [] };
  }

  const sections = periodMonths >= 12 ? 4 : periodMonths;
  const labels =
    periodMonths >= 12
      ? ["Q1", "Q2", "Q3", "Q4"]
      : Array.from({ length: sections }, (_, i) => (i + 1).toString());

  const interval = totalMs / sections;

  const allHighs = window.stockData
    ? window.stockData.map((r) => parseFloat(r.high) || 0)
    : [0];
  const maxHigh = Math.max(...allHighs);
  const safeY = maxHigh || 0;

  const points = [];
  const xaxis = [];

  for (let i = 0; i < sections; i++) {
    const sectionStart = new Date(startDate.getTime() + interval * i);
    const sectionEnd = new Date(startDate.getTime() + interval * (i + 1));
    const middle = new Date(
      (sectionStart.getTime() + sectionEnd.getTime()) / 2
    );

    let midIdx = window.tradingDates.findIndex(
      (d) => new Date(d).getTime() >= middle.getTime()
    );
    if (midIdx === -1) midIdx = window.tradingDates.length - 1;

    // 上方 Q1 / 1 / 2 ... 標籤
    points.push({
      x: window.tradingDates[midIdx],
      y: safeY,
      yAxisIndex: 0,
      marker: { size: 0 },
      label: {
        borderColor: "transparent",
        offsetY: -5,
        style: {
          background: "transparent",
          color: "#555",
          fontSize: "14px",
          fontWeight: "900",
        },
        text: labels[i] || (i + 1).toString(),
        cssClass: "period-label",
      },
    });

    // 區隔虛線
    if (i < sections - 1) {
      let lineIdx = window.tradingDates.findIndex(
        (d) => new Date(d).getTime() >= sectionEnd.getTime()
      );
      if (lineIdx !== -1 && lineIdx < window.tradingDates.length - 1) {
        xaxis.push({
          x: window.tradingDates[lineIdx],
          strokeDashArray: 4,
          borderColor: "#777",
          borderWidth: 1,
          opacity: 0.6,
          cssClass: "period-separator",
        });
      }
    }
  }

  return { points, xaxis };
}

// ==========================================
// 分析面板按鈕：開 / 關 右側控制面板
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const controlBtn = document.getElementById("controlPanelToggle");
  const controlPanel = document.getElementById("controlPanel");

  if (controlBtn && controlPanel) {
    // 用 onclick 強制綁定一次，避免被別的程式碼覆蓋
    controlBtn.onclick = (e) => {
      e.preventDefault();
      console.log("分析面板按鈕被點擊！");

      // 切換面板顯示狀態 (對應 .control-panel-right.open)
      const isOpen = controlPanel.classList.toggle("open");

      // 按鈕本身也加上 active 樣式（如果你有寫）
      controlBtn.classList.toggle("active", isOpen);
    };
    console.log("分析面板按鈕綁定完成");
  } else {
    console.error(
      "找不到分析面板按鈕 (controlPanelToggle) 或面板本體 (controlPanel)"
    );
  }
});

function resetAllSelections() {
  // 1. 將所有 checkbox (技術指標 + 條件判斷) 的勾選狀態拿掉
  document.querySelectorAll(".indicator-check, .rule-check").forEach((cb) => {
    cb.checked = false;
  });

  // 2. 更新技術指標線圖 (這會把線清掉)
  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }

  // 3. 更新條件判斷標註 (這會把倒三角形清掉)
  // 我們直接呼叫 applyRules，它會去讀現在的 checkbox (都是空的)，進而清除圖表
  if (typeof applyRules === "function") {
    applyRules();
  }
}

// //產生未來30天的預測收盤價
// // function buildFuture30Series(baseClose, directions, scores, futureDates) {
// //   const series = [];
// //   let prev = baseClose;

// //   for (let i = 0; i < 30; i++) {
// //     const dir = directions[i];
// //     let score = Number(scores[i]) || 0;

// //     if (dir === "up") score = +Math.abs(score);
// //     if (dir === "down") score = -Math.abs(score);
// //     if (dir === "flat") score = 0;

// //     const yVal = prev + score;
// //     prev = yVal;

// //     series.push({
// //       x: futureDates[i],
// //       y: yVal,
// //     });
// //   }

// //   return series;
// // }

// // 預測柱狀圖的固定設定
// const PREDICT_BAR_HEIGHT = 3; // 柱子的高度單位（可微調）
// const PREDICT_BASE_LINE = 1.0; // 預測柱子的共同基準線（一個相對值，可微調）

// function buildFuture30Series(baseClose, directions, scores, futureDates) {
//   const series = [];

//   // 計算預測柱的基準 Y 座標
//   // 我們需要找到一個不會干擾 K 線圖價格區間的低位
//   // 這裡簡單地將基準線設定為最低價的約 95% 處
//   const allLows = window.stockData
//     ? window.stockData.map((r) => parseFloat(r.low) || Infinity)
//     : [Infinity];
//   const minLow = Math.min(...allLows);
//   // 將基準線設在最低價的下方，以確保與 K 線分離。
//   const safeBaseY = minLow * 0.95 || 100; // 如果 minLow 為 0 或不存在，使用 100 作為預設基準

//   // 根據漲跌平設定不同的 Y 軸起始位置 (Start Y Value)
//   const riseYStart = safeBaseY + PREDICT_BASE_LINE + PREDICT_BAR_HEIGHT; // 較高
//   const flatYStart = safeBaseY + PREDICT_BASE_LINE; // 中間
//   const dropYStart = safeBaseY + PREDICT_BASE_LINE - PREDICT_BAR_HEIGHT; // 較低

//   for (let i = 0; i < 30; i++) {
//     const dir = directions[i];
//     let yStart;
//     let color;

//     // 判斷方向並給予不同的起始 Y 座標
//     if (dir === "up") {
//       yStart = riseYStart;
//       color = "#e74c3c"; // 紅色 (漲)
//     } else if (dir === "down") {
//       yStart = dropYStart;
//       color = "#2ecc71"; // 綠色 (跌)
//     } else {
//       // 'flat'
//       yStart = flatYStart;
//       color = "#999999"; // 灰色 (平)
//     }

//     // ApexCharts 的柱狀圖只需要 Y 值，它會自動計算高度
//     // 為了讓它保持一致的高度 (PREDICT_BAR_HEIGHT)，我們需要確保資料點是唯一的。
//     // 然而，ApexCharts 的 Bar 圖表實際上是畫在 Y 值的「底部」或「頂部」，
//     // 這裡我們模擬一個固定長度的柱子。最簡單的方式是讓它成為一個 **Hollow Column**。
//     // 但由於 Bar Chart 不支援 OHLC 結構，最簡單的方式是繪製一個單一 Y 值。

//     // 為了讓所有柱子高度一樣，我們需要用到 Stacked Bar 或特殊的 Y 軸/ PlotOption。
//     // 但這裡我們使用「在 Y 軸上畫一個固定值」的方法來模擬位置，但這會讓柱子從 0 畫到該值。

//     // **最簡單且有效的視覺替代方案：**
//     // 畫一個從「安全基準線」開始，到「基準線 + 位置偏移」結束的柱子。
//     // 由於我們想要高度一致，我們改用 **Range Bar** 來實現固定高度。

//     // 由於您使用了 `type: "bar"`，我們需要返回 [yStart, yEnd] 陣列來模擬柱子高度和位置。
//     // **但 ApexCharts 的標準 Bar Chart 不支援 Range Bar。**
//     //
//     // **修正為：繪製一個固定高度的點，其高度由 Y 軸的 Max/Min 決定**
//     // 我們讓柱子的 Y 軸值為 (基準線 + 偏移量)。

//     series.push({
//       x: futureDates[i],
//       // 讓柱子顯示的值為固定的「基準線 + 該方向的偏移量」
//       y: yStart,
//       fillColor: color,
//       color: color, // 確保顏色被傳遞
//     });
//   }

//   // ⚠️ 額外提示：由於柱子的高度會從 Y=0 畫到 yStart，您可能需要調整安全基準線 (safeBaseY)
//   // 或是將預測柱系列設定為獨立的 Y 軸，以控制其繪製範圍。
//   // 為了簡單，目前先採用：yStart 越高的，柱子越高。

//   return series;
// }

// // function applyFuture30Series(seriesData) {
// //   if (!window.priceChartInst) return;

// //   futurePredictionSeries = {
// //     name: "Future30",
// //     type: "bar",
// //     data: seriesData,
// //     color: "#a8a8a8ff",
// //   };

// //   const current = window.priceChartInst.w.config.series;

// //   window.priceChartInst.updateOptions(
// //     {
// //       xaxis: buildSharedXAxis(), // ★ 保證 categories 同步
// //       series: [...current, futurePredictionSeries],
// //     },
// //     false,
// //     true
// //   );
// // }

// // function applyFuture30Series(seriesData) {
// //   if (
// //     !window.priceChartInst ||
// //     !window.tradingDates ||
// //     !window.originalTradingDates
// //   )
// //     return; // 計算歷史資料的長度 N

// //   const N = window.originalTradingDates.length; // 產生 N 個 null 點，確保預測柱狀圖從第 N+1 個類別（即第 N 個 index）開始顯示
// //   const nullPadding = Array(N).fill(null); // 將預測資料包裝成完整的系列，並在前面補上 null // 由於 seriesData 已經是 { x: date, y: value } 的格式，我們只需要對應的 y 值 // 但 ApexCharts 的 Bar 圖允許傳入 { x, y }，因此我們需要確保 x 與 categories 對齊。 // 然而，最簡單的方式是確保 series data 的長度與 categories 一致。 // 這裡採用更穩健的方法：將 seriesData 的 y 值與 nullPadding 合併， // 並維持 seriesData 的 {x, y} 格式，但補上 null 的 {x, y: null}
// //   const paddedSeriesData = window.tradingDates.map((date, index) => {
// //     if (index < N) {
// //       // 歷史區間：不畫柱子
// //       return { x: date, y: null };
// //     } else {
// //       // 未來區間：從 seriesData 中取值
// //       const futureIndex = index - N;
// //       return seriesData[futureIndex] || { x: date, y: null };
// //     }
// //   });

// //   futurePredictionSeries = {
// //     name: "Future30",
// //     type: "bar",
// //     data: paddedSeriesData, // 使用補齊後的資料
// //     yAxisIndex: 0, // 放在價格軸上
// //     color: "#a8a8a8",
// //     tooltip: {
// //       // 覆寫 tooltip 避免干擾 K 線圖的 custom tooltip
// //       enabled: false,
// //     },
// //   };

// //   const existing = window.priceChartInst.w.config.series.filter(
// //     // 先確保移除舊的 Future30 (如果有)
// //     (s) => s.name !== "Future30"
// //   );

// //   window.priceChartInst.updateOptions(
// //     {
// //       xaxis: buildSharedXAxis(),
// //       series: [...existing, futurePredictionSeries], // 將新的 Future30 加到最後
// //     },
// //     false,
// //     true
// //   );
// //   console.log("✔ Future30 series applied with padding.");
// // }

// function applyFuture30Series(seriesData) {
//   if (
//     !window.priceChartInst ||
//     !window.tradingDates ||
//     !window.originalTradingDates
//   )
//     return;

//   // 1. 計算歷史資料的長度 (N)
//   const N = window.originalTradingDates.length;
//   const paddedSeriesData = [];
//   const totalLength = window.tradingDates.length;

//   // 2. 補齊資料並帶上顏色
//   for (let i = 0; i < totalLength; i++) {
//     const date = window.tradingDates[i];

//     if (i < N) {
//       paddedSeriesData.push({ x: date, y: null, fillColor: undefined });
//     } else {
//       const futureIndex = i - N;
//       const dataPoint = seriesData[futureIndex] || { x: date, y: null };
//       paddedSeriesData.push(dataPoint); // dataPoint 內已經有 x, y, color
//     }
//   }

//   // 3. 建立新的預測系列配置
//   futurePredictionSeries = {
//     name: "Future30",
//     type: "bar",
//     data: paddedSeriesData,
//     yAxisIndex: 0,
//     // ⚠️ 注意：這裡的 color 必須被覆蓋為透明或移除，
//     // 因為真正的顏色在每個 data point (fillColor) 裡！
//     color: "#a8a8a8", // 設為通用色，但會被 data 裡的 fillColor 覆蓋
//   };

//   const existing = window.priceChartInst.w.config.series.filter(
//     (s) => s.name !== "Future30"
//   );

//   window.priceChartInst.updateOptions(
//     {
//       xaxis: buildSharedXAxis(),
//       series: [...existing, futurePredictionSeries],
//       // ★ 關鍵：覆蓋 PlotOptions 以使用 data 裡的 fillColor
//       plotOptions: {
//         bar: {
//           columnWidth: "70%",
//           colors: {
//             // 告訴 ApexCharts 顏色來自 Data Point
//             ranges: [{ from: 0, to: 1000000, color: undefined }],
//             // ApexCharts 會自動尋找 data.fillColor
//           },
//         },
//       },
//     },
//     false,
//     true
//   );
//   console.log("✔ Future30 series applied with custom colors for direction.");
// }

// // 備註：您的 removeFuture30Series 函式已經正確地將系列從圖表移除。
// // 您不需要對它進行任何更改。

// // function removeFuture30Series() {
// //   if (!window.priceChartInst) return;

// //   const filtered = window.priceChartInst.w.config.series.filter(
// //     (s) => s.name !== "Future30"
// //   );

// //   window.priceChartInst.updateOptions(
// //     {
// //       xaxis: buildSharedXAxis(), // ★ 保證還原後 categories 正確
// //       series: filtered,
// //     },
// //     false,
// //     true
// //   );

// //   futurePredictionSeries = null;
// // }

// function removeFuture30Series() {
//   if (!window.priceChartInst) return;

//   const filtered = window.priceChartInst.w.config.series.filter(
//     (s) => s.name !== "Future30"
//   );

//   window.priceChartInst.updateOptions(
//     {
//       xaxis: buildSharedXAxis(), // ★ 保證 index 對齊原始資料
//       series: filtered,
//     },
//     false,
//     true
//   );

//   futurePredictionSeries = null;
// }

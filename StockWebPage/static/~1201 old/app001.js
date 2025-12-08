console.log("app_clean_v1");

// 後端 FastAPI 反向代理的前綴；用同源更簡單
const API_BASE = "/api";
const menuContainer = document.getElementById("menuContainer");
const dropdownMenu = document.getElementById("dropdownMenu");

window.priceChartInst = null;
window.volumeChartInst = null;

// 1. 定義全域狀態 (Single Source of Truth) - 移到最上方確保存取得到
window.appState = {
  rules: [], // 存放目前勾選的規則
  showPeriods: false, // 是否顯示時間區隔
  currentMonths: 3, // 目前的時間長度
};

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
      window.location.hash = "";
      alert("登入成功");
    });
}
window.onload = checkLoginStatus;

// 成交量壓縮比例
let VOL_PAD_TOP_RATIO = 0.1;
// 指標清單
const INDICATORS = [
  { key: "Sma_5", name: "SMA_5", cb: "chkSma5" },
  { key: "Sma_10", name: "SMA_10", cb: "chkSma10" },
  { key: "Sma_20", name: "SMA_20", cb: "chkSma20" },
  { key: "Sma_60", name: "SMA_60", cb: "chkSma60" },
];

let chart;

// === 視窗範圍工具 ===
function getCurrentXRange() {
  const w = window.priceChartInst?.w;
  if (!w) return null;
  const min = w.globals?.minX;
  const max = w.globals?.maxX;
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function restoreXRange(range) {
  if (!range) return;
  setTimeout(() => {
    ["pricePane", "volumePane"].forEach((id) => {
      try {
        ApexCharts.exec(id, "zoomX", range.min, range.max);
      } catch (e) {}
    });
  }, 0);
}

// 儲存目前勾選的函式 (技術指標)
function getCheckedIndicators() {
  return Array.from(document.querySelectorAll(".indicator-check:checked")).map(
    (el) => el.value
  );
}

function restoreCheckedIndicators(checkedIndicators) {
  document.querySelectorAll(".indicator-check").forEach((el) => {
    el.checked = checkedIndicators.includes(el.value);
  });
}

function applyIndicators() {
  if (window.updateIndicatorsFromChecked) {
    window.updateIndicatorsFromChecked();
  }
}

// 儲存條件判斷勾選狀態 (規則)
function getCheckedRules() {
  return Array.from(document.querySelectorAll(".rule-check:checked")).map(
    (el) => el.value
  );
}

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
  price: ["Sma_5", "Sma_10", "Sma_20", "Sma_60", "Sma_120", "Sma_240"],
  macd: ["DIF", "DEA"],
  kdj: ["K", "D", "J"],
  bias: ["Bias"],
};

function getSymbol() {
  return document.getElementById("symbolInput").value || "AAPL";
}

function selectSymbol(symbol) {
  const input = document.getElementById("symbolInput");
  const suggestionsDiv = document.getElementById("suggestions");
  const searchContainer = document.getElementById("searchContainer");
  const searchToggle = document.getElementById("searchToggle");

  if (input) input.value = symbol;
  if (suggestionsDiv) suggestionsDiv.style.display = "none";
  if (searchContainer) searchContainer.classList.add("hidden");
  if (searchToggle) searchToggle.style.display = "flex";

  const customDiv = document.getElementById("customDateRange");
  if (customDiv) customDiv.style.display = "none";

  const controlPanel = document.getElementById("controlPanel");
  if (controlPanel) controlPanel.classList.remove("open");

  loadStockWithRange(symbol, "3m");
}

async function loadStockWithRange(symbol, range) {
  // 1. 先記住目前使用者勾選了哪些技術線和條件
  const checkedIndicatorsBefore = getCheckedIndicators();
  const checkedRulesBefore = getCheckedRules();

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

    await displayStockData(data, symbol);

    restoreCheckedIndicators(checkedIndicatorsBefore);
    applyIndicators();
    restoreCheckedRules(checkedRulesBefore);
    applyRules(); // 呼叫新版 applyRules
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

  await displayStockData(data, symbol);

  // 還原使用者勾選與條件標註
  restoreCheckedIndicators(checkedIndicatorsBefore);
  applyIndicators();

  restoreCheckedRules(checkedRulesBefore);
  applyRules(); // 呼叫新版 applyRules

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

  window.updateIndicatorsFromChecked = () => {
    const checked = Array.from(
      document.querySelectorAll(".indicator-check:checked")
    ).map((cb) => cb.value);
    const range = getCurrentXRange();
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
    restoreXRange(range);
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

  // ★ 這裡原本有舊的 addPeriodSeparators 呼叫，已經移除，改由 renderAllAnnotations 統一處理
  renderAllAnnotations();
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
    title: { text: "Volume", offsetX: 5 },
    min: 0,
    max: Math.ceil(vmax * (1 + ratio)),
    labels: { offsetX: 15, formatter: formatVolume },
  };
}

function makeXAxisCategories() {
  return {
    type: "category",
    categories: window.tradingDates,
    tickAmount: Math.min(12, window.tradingDates?.length || 12),
    tickPlacement: "on",
    labels: {
      show: true,
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
  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length === 3) {
      return `${parts[1].padStart(2, "0")}/${parts[2].padStart(2, "0")}`;
    }
  }
  return s;
}

function getTickAmountByMonths() {
  const m = window.appState.currentMonths || 3;
  if (m >= 36) return 14;
  if (m >= 12) return 14;
  if (m >= 6) return 12;
  if (m >= 3) return 12;
  return Math.min(10, window.tradingDates?.length || 10);
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
      formatter: (val) => formatDateMMDD(val),
    },
    axisBorder: { show: true },
    axisTicks: { show: true },
    tooltip: { enabled: false },
  };
}

function syncXAxes() {
  const base = buildSharedXAxis();
  const priceXAxis = {
    ...base,
    labels: { ...base.labels, show: false },
    axisTicks: { ...base.axisTicks, show: false },
  };
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
  if (window.volumeChartInst && window.stockData) {
    // 重新呼叫 makeVolumeYAxis 即可
    window.volumeChartInst.updateOptions(
      { yaxis: makeVolumeYAxis() },
      false,
      false
    );
  }
}

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
  const btn = document.querySelector(".calendar-btn");
  if (!div || !btn) return;

  const isHidden = window.getComputedStyle(div).display === "none";

  if (isHidden) {
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

    const btnRect = btn.getBoundingClientRect();
    const cardRect = div.getBoundingClientRect();
    let left = btnRect.right - cardRect.width;
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

  const customDiv = document.getElementById("customDateRange");
  if (customDiv) customDiv.style.display = "none";

  loadStockWithRange(getSymbol(), range).then(() => {
    let months = 3;
    if (range === "1m") months = 1;
    else if (range === "3m") months = 3;
    else if (range === "6m") months = 6;
    else if (range === "1y") months = 12;
    else if (range === "3y") months = 36;
    else if (range === "5d") months = 1;
    else if (range === "ytd") months = 12;

    addPeriodSeparators(months); // 更新 appState.currentMonths
  });
}

const symbolInput = document.getElementById("symbolInput");
const suggestions = document.getElementById("suggestions");

if (symbolInput) {
  symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = symbolInput.value.trim();
      if (text) selectSymbol(text.toUpperCase());
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";
      if (suggestions) suggestions.style.display = "none";
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) customDiv.style.display = "none";
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) controlPanel.classList.remove("open");
    } else if (e.key === "Escape") {
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";
      if (suggestions) suggestions.style.display = "none";
    }
  });
}

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
      return `<div style='padding:8px; cursor:pointer' onclick='selectSymbol("${item.symbol}")'>${item.symbol} - ${nameDisplay}</div>`;
    })
    .join("");
  suggestions.style.display = "block";
}

document.addEventListener("click", function (event) {
  const suggestionsDiv = document.getElementById("suggestions");
  const input = document.getElementById("symbolInput");
  if (!suggestionsDiv.contains(event.target) && event.target !== input) {
    suggestionsDiv.style.display = "none";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadStockWithRange("AAPL", "3m");

  const searchToggle = document.getElementById("searchToggle");
  const searchContainer = document.getElementById("searchContainer");
  if (searchToggle && searchContainer) {
    searchToggle.addEventListener("click", () => {
      searchContainer.classList.remove("hidden");
      searchToggle.style.display = "none";
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) customDiv.style.display = "none";
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) controlPanel.classList.remove("open");
      const input = document.getElementById("symbolInput");
      if (input) {
        input.focus();
        input.select();
      }
    });
  }
  const pillIcon = document.querySelector(".search-pill-icon");
  if (pillIcon && searchContainer && searchToggle) {
    pillIcon.addEventListener("click", () => {
      searchContainer.classList.add("hidden");
      searchToggle.style.display = "flex";
      if (typeof suggestions !== "undefined" && suggestions) {
        suggestions.style.display = "none";
      }
    });
  }

  if (window.flatpickr) {
    if (flatpickr.l10ns && flatpickr.l10ns.zh_tw) {
      flatpickr.localize(flatpickr.l10ns.zh_tw);
    }
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
            left = inputRect.left;
          } else {
            left = inputRect.right - calRect.width;
          }
          if (left < margin) left = margin;
          if (left + calRect.width > window.innerWidth - margin) {
            left = window.innerWidth - calRect.width - margin;
          }
          cal.style.left = left + "px";
          cal.style.top = inputRect.bottom + 6 + "px";
        });
      },
    };
    flatpickr("#customStart", commonOptions);
    flatpickr("#customEnd", commonOptions);
  }

  const defaultBtn = document.querySelector(
    ".time-range-item[onclick*=\"'3m'\"]"
  );
  if (defaultBtn) defaultBtn.classList.add("active");
});

const indicatorColors = {
  Sma_5: "#e74c3c",
  Sma_10: "#3498db",
  Sma_20: "#27ae60",
  Sma_60: "#f39c12",
  Sma_120: "#9b59b6",
  Sma_240: "#16a085",
  DIF: "#d35400",
  DEA: "#8e44ad",
  K: "#2ecc71",
  D: "#2980b9",
  J: "#c0392b",
  Bias: "#7f8c8d",
};

document.querySelectorAll(".indicator-check").forEach((cb) => {
  const color = indicatorColors[cb.value];
  if (color) {
    cb.parentElement.style.color = color;
    cb.dataset.color = color;
  }
});

// ==========================================
// ★ 全新重寫：集中式標註管理系統
// ==========================================

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
 * 產生條件標註陣列 (純計算)
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

    let matchedText = "";
    if (rules.length === 1) {
      if (checks[rules[0]] && checks[rules[0]]())
        matchedText = labelMap[rules[0]];
    } else {
      const allPass = rules.every((r) => checks[r] && checks[r]());
      if (allPass) matchedText = rules.map((r) => labelMap[r]).join("");
    }

    if (matchedText) {
      points.push({
        x: window.tradingDates[i],
        y: parseFloat(row.low) * 0.98,
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
 * 產生時間區隔標註 (純計算)
 */
function getPeriodAnnotations(periodMonths) {
  if (!window.tradingDates || window.tradingDates.length === 0)
    return { points: [], xaxis: [] };
  if (periodMonths <= 1) return { points: [], xaxis: [] };

  const startDate = new Date(window.tradingDates[0]);
  const endDate = new Date(window.tradingDates[window.tradingDates.length - 1]);
  const totalMs = endDate - startDate;
  if (totalMs <= 0) return { points: [], xaxis: [] };

  let sections = periodMonths >= 12 ? 4 : periodMonths;
  let labels =
    periodMonths >= 12
      ? ["Q1", "Q2", "Q3", "Q4"]
      : Array.from({ length: sections }, (_, i) => (i + 1).toString());

  const interval = totalMs / sections;
  let xaxis = [];
  let points = [];

  // 計算一個安全的 Y 軸高度
  const allHighs = window.stockData.map((r) => parseFloat(r.high));
  const maxHigh = Math.max(...allHighs);
  const safeY = maxHigh ? maxHigh : 0;

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
      },
    });

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
          label: { show: false },
        });
      }
    }
  }
  return { points, xaxis };
}

// 1. 條件判斷 Checkbox 變更時
function bindRuleCheckboxes() {
  const boxes = document.querySelectorAll(".rule-check");
  boxes.forEach((cb) => {
    cb.onchange = () => {
      const checked = Array.from(
        document.querySelectorAll(".rule-check:checked")
      ).map((c) => c.value);
      window.appState.rules = checked;
      renderAllAnnotations();
    };
  });
}

// 2. 切換區隔按鈕
function togglePeriods() {
  window.appState.showPeriods = !window.appState.showPeriods;
  const btn = document.getElementById("togglePeriodsBtn");
  if (btn) {
    btn.classList.toggle("active", window.appState.showPeriods);
    btn.textContent = window.appState.showPeriods ? "關閉區隔" : "顯示區隔";
  }
  renderAllAnnotations();
}

// 3. 舊相容介面
function applyRules() {
  const checked = Array.from(
    document.querySelectorAll(".rule-check:checked")
  ).map((c) => c.value);
  window.appState.rules = checked;
  renderAllAnnotations();
}

function addPeriodSeparators(months) {
  window.appState.currentMonths = months;
  renderAllAnnotations();
}

function resetAllSelections() {
  document.querySelectorAll(".indicator-check, .rule-check").forEach((cb) => {
    cb.checked = false;
  });
  if (typeof window.updateIndicatorsFromChecked === "function")
    window.updateIndicatorsFromChecked();
  applyRules(); // 清空倒三角
}

// 初始化綁定
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindRuleCheckboxes);
} else {
  bindRuleCheckboxes();
}

// 強制修復：分析面板按鈕
document.addEventListener("DOMContentLoaded", () => {
  const controlBtn = document.getElementById("controlPanelToggle");
  const controlPanel = document.getElementById("controlPanel");
  if (controlBtn && controlPanel) {
    controlBtn.onclick = (e) => {
      e.preventDefault();
      const isOpen = controlPanel.classList.toggle("open");
      controlBtn.classList.toggle("active", isOpen);
    };
  }
});

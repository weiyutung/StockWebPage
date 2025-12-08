console.log("app_new_fixed");

// 後端 FastAPI 反向代理的前綴
const API_BASE = "/api";

// DOM 元素
const menuContainer = document.getElementById("menuContainer");
const dropdownMenu = document.getElementById("dropdownMenu");

// 全域變數
window.priceChartInst = null;
window.volumeChartInst = null;
window.stockData = [];
window.tradingDates = [];
window.originalTradingDates = null; // 紀錄未加未來 30 天前的日期
window.originalZoomRange = null; // 紀錄 Zoom 狀態
window.futurePredictionSeries = null; // 存放預測圖 Series

// ★ 全域狀態管理 (Single Source of Truth)
window.appState = {
  rules: [], // 內建規則 (e.g. 'three-red')
  builderMarkers: [], // 拖曳 Builder 產生的標記點
  showPeriods: false, // 是否顯示 Q1/Q2 分隔
  currentMonths: 3, // 目前區間長度
  futureAdded: false, // 是否已加入未來 30 天
};

// ==========================================
// 1. Supabase 登入與驗證邏輯
// ==========================================
async function handleRedirect() {
  const hash = window.location.hash;
  if (hash && hash.includes("access_token")) {
    const { data, error } = await client.auth.getSessionFromUrl({
      storeSession: true,
    });
    if (error) console.error("登入失敗:", error.message);
    else console.log("登入成功:", data.session?.user);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
handleRedirect();

if (menuContainer && dropdownMenu) {
  menuContainer.addEventListener(
    "mouseenter",
    () => (dropdownMenu.style.display = "block")
  );
  menuContainer.addEventListener(
    "mouseleave",
    () => (dropdownMenu.style.display = "none")
  );
}

async function logout() {
  const { error } = await client.auth.signOut();
  if (!error) {
    alert("已登出");
    checkLoginStatus();
  }
}

async function checkLoginStatus() {
  const {
    data: { user },
  } = await client.auth.getUser();
  const emailSpan = document.getElementById("user-email");
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const logoutBtn = document.getElementById("logout-btn");

  if (user) {
    if (emailSpan) {
      emailSpan.textContent = user.email;
      emailSpan.style.display = "block";
    }
    if (loginBtn) loginBtn.style.display = "none";
    if (registerBtn) registerBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "block";
  } else {
    if (emailSpan) emailSpan.style.display = "none";
    if (loginBtn) loginBtn.style.display = "block";
    if (registerBtn) registerBtn.style.display = "block";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

const hashParams = new URLSearchParams(window.location.hash.substring(1));
if (hashParams.get("access_token") && hashParams.get("refresh_token")) {
  supabase.auth
    .setSession({
      access_token: hashParams.get("access_token"),
      refresh_token: hashParams.get("refresh_token"),
    })
    .then(() => {
      window.location.hash = "";
      alert("登入成功");
    });
}
window.onload = checkLoginStatus;

// ==========================================
// 2. 圖表核心設定與繪製
// ==========================================
let VOL_PAD_TOP_RATIO = 0.1;

// 技術指標定義
const indicatorGroups = {
  price: ["Sma_5", "Sma_10", "Sma_20", "Sma_60", "Sma_120", "Sma_240"],
  macd: ["DIF", "DEA"],
  kdj: ["K", "D", "J"],
  bias: ["Bias"],
};

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

// 視窗範圍工具
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

// 取得股票資料
async function loadStockWithRange(symbol, range) {
  // 1. 暫存狀態
  const checkedIndicators = getCheckedIndicators();
  const builderState = getBuilderState();

  // 2. 決定 API 參數
  let url = "";
  if (range === "custom") {
    const start = document.getElementById("customStart").value;
    const end = document.getElementById("customEnd").value;
    if (!start || !end) return alert("請先選擇起訖日期");
    url = `${API_BASE}/stocks/range?symbol=${encodeURIComponent(
      symbol
    )}&start=${start}&end=${end}`;
  } else {
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
      count = Math.ceil(Math.abs(today - startOfYear) / 86400000);
    }
    url = `${API_BASE}/stocks?symbol=${encodeURIComponent(
      symbol
    )}&count=${count}`;
  }

  // 3. Fetch 資料
  const resp = await fetch(url);
  if (!resp.ok) return alert("查詢失敗");
  const data = await resp.json();
  if (!data || data.length === 0) return alert("查無資料");

  // 4. 重置全域變數
  window.futurePredictionSeries = null;
  window.appState.futureAdded = false;
  const futureBtn = document.getElementById("future30Btn");
  if (futureBtn) {
    futureBtn.textContent = "加入未來30天";
    futureBtn.classList.remove("active");
  }

  // 5. 繪製圖表
  await displayStockData(data, symbol);

  // 6. 還原狀態
  restoreCheckedIndicators(checkedIndicators);
  restoreBuilderState(builderState);

  // 重新套用指標與條件
  if (window.updateIndicatorsFromChecked) window.updateIndicatorsFromChecked();
  applyConditionBuilder(true);
}

// 顯示圖表主函式
async function displayStockData(data, symbol) {
  window.stockData = data;
  window.tradingDates = data.map((row) => {
    const d = new Date(row.date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // K線資料
  const chartData = data.map((row, idx) => ({
    x: window.tradingDates[idx],
    y: [+row.open, +row.high, +row.low, +row.close],
  }));

  // 成交量資料
  const volData = data.map((row, idx) => ({
    x: window.tradingDates[idx],
    y: +row.volume || 0,
    fillColor: +row.close >= +row.open ? "#e74c3c" : "#2ecc71",
  }));

  document.getElementById("chartTitle").innerText = symbol;

  // 銷毀舊圖表
  if (window.priceChartInst) window.priceChartInst.destroy();
  if (window.volumeChartInst) window.volumeChartInst.destroy();

  // 建立 X 軸配置 (Category 模式)
  const commonXAxis = buildSharedXAxis();

  // 上圖配置 (Price)
  const optionsPrice = {
    chart: {
      id: "pricePane",
      group: "stockPane",
      type: "candlestick",
      height: 370,
      zoom: { enabled: true, type: "x", autoScaleYaxis: false },
      events: {
        // Zoom 時重新對齊 Volume 軸
        zoomed: () => {
          ensureVolumeAxis();
        },
      },
    },
    series: [{ name: "K線圖", type: "candlestick", data: chartData }],
    xaxis: {
      ...commonXAxis,
      labels: { show: false },
      axisTicks: { show: false },
    },
    yaxis: [
      { show: true, labels: { formatter: (v) => v.toFixed(2) } }, // 0: Price
      { show: false, opposite: true }, // 1: MACD
      { show: false, opposite: true }, // 2: KDJ
      { show: false, opposite: true }, // 3: Bias
    ],
    plotOptions: {
      candlestick: { colors: { upward: "#e74c3c", downward: "#2ecc71" } },
    },
    tooltip: { shared: true, custom: customTooltip }, // 使用自定義 Tooltip
    grid: { padding: { top: 0, right: 0, bottom: -5, left: 16 } },
    legend: { show: false },
  };

  // 下圖配置 (Volume)
  const optionsVolume = {
    chart: {
      id: "volumePane",
      group: "stockPane",
      type: "bar",
      height: 130,
      zoom: { enabled: false },
      toolbar: { show: false },
    },
    series: [{ name: "Volume", data: volData }],
    xaxis: commonXAxis,
    yaxis: makeVolumeYAxis(),
    grid: { padding: { top: -20, right: -25, bottom: 0, left: 28 } },
    dataLabels: { enabled: false },
    tooltip: { enabled: true, shared: false, intersect: true },
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

  // 初始化指標更新函式
  initIndicatorUpdater(chartData);

  // 畫初始的時間區隔線
  renderAllAnnotations();
}

// ==========================================
// 3. 標註系統 (核心修正部分)
// ==========================================

// ★ 統一渲染函式：負責畫所有東西 (時間區隔、條件點、Builder點)
function renderAllAnnotations() {
  if (!window.priceChartInst || !window.stockData || !window.tradingDates)
    return;

  // 1. 內建規則 (three-red 等)
  const rulePoints = getConditionAnnotations(window.appState.rules);

  // 2. Builder 自訂拖曳條件 (從 appState 拿)
  const builderPoints = window.appState.builderMarkers || [];

  // 3. 時間區隔
  const periodData = window.appState.showPeriods
    ? getPeriodAnnotations(window.appState.currentMonths)
    : { points: [], xaxis: [] };

  // 4. 合併
  const finalPoints = [...rulePoints, ...builderPoints, ...periodData.points];
  const finalXaxis = [...periodData.xaxis];

  // 5. 更新圖表
  window.priceChartInst.updateOptions({
    annotations: {
      xaxis: finalXaxis,
      points: finalPoints,
    },
  });
}

// 計算條件標註 (修正 X 座標為字串)
function getConditionAnnotations(rules) {
  if (!rules || rules.length === 0) return [];
  let points = [];

  const labelMap = {
    "sma-cross": "SMA↑",
    "three-red": "連紅",
    "bias-high": "乖離高",
  }; // 可自行擴充

  window.stockData.forEach((row, i) => {
    // 這裡放入你的邏輯判斷 (範例)
    const prev = window.stockData[i - 1];
    if (!prev) return;

    let matched = [];
    // 範例邏輯：
    if (rules.includes("three-red")) {
      const p2 = window.stockData[i - 2];
      if (
        p2 &&
        row.close > row.open &&
        prev.close > prev.open &&
        p2.close > p2.open
      )
        matched.push("連紅");
    }
    // ... 其他邏輯複製你的 checks 物件 ...

    if (matched.length > 0) {
      points.push({
        x: window.tradingDates[i], // ★ 關鍵：使用字串日期
        y: parseFloat(row.low) * 0.98,
        yAxisIndex: 0,
        marker: { size: 5, fillColor: "#000", shape: "triangle" },
        label: {
          text: matched.join(","),
          style: { background: "transparent", color: "#000" },
        },
      });
    }
  });
  return points;
}

// 計算時間區隔
function getPeriodAnnotations(periodMonths) {
  if (!window.tradingDates.length || periodMonths <= 1)
    return { points: [], xaxis: [] };

  // 簡化計算邏輯：平均切分
  const total = window.tradingDates.length;
  const sections = periodMonths >= 12 ? 4 : periodMonths;
  const chunkSize = Math.floor(total / sections);
  const labels =
    periodMonths >= 12
      ? ["Q1", "Q2", "Q3", "Q4"]
      : Array.from({ length: sections }, (_, i) => (i + 1).toString());

  const points = [];
  const xaxis = [];
  const maxY = Math.max(...window.stockData.map((r) => +r.high));

  for (let i = 1; i <= sections; i++) {
    const idx = i * chunkSize;
    if (idx < total) {
      // 畫虛線
      xaxis.push({
        x: window.tradingDates[idx], // ★ 使用字串
        strokeDashArray: 4,
        borderColor: "#777",
        opacity: 0.5,
      });
    }
    // 畫標籤 (放在區塊中間)
    const midIdx = Math.floor(idx - chunkSize + chunkSize / 2);
    if (window.tradingDates[midIdx]) {
      points.push({
        x: window.tradingDates[midIdx],
        y: maxY,
        yAxisIndex: 0,
        marker: { size: 0 },
        label: {
          text: labels[i - 1],
          style: {
            background: "transparent",
            color: "#999",
            fontSize: "14px",
            fontWeight: "bold",
          },
        },
      });
    }
  }
  return { points, xaxis };
}

// ==========================================
// 4. 預測柱狀圖 (修正顯示部分)
// ==========================================
async function toggleFuture30Days() {
  const futureBtn = document.getElementById("future30Btn");

  // A. 加入預測
  if (!window.appState.futureAdded) {
    const symbol = document.getElementById("symbolInput").value || "AAPL";
    const resp = await fetch(`${API_BASE}/prediction?symbol=${symbol}`);
    if (!resp.ok) return alert("預測資料失敗");
    const pred = await resp.json();

    const directions = JSON.parse(pred.pred_json);
    const baseClose = pred.base_close;

    // 備份
    window.originalTradingDates = [...window.tradingDates];
    window.originalZoomRange = getCurrentXRange();

    // 產生未來日期
    const lastDate = new Date(window.tradingDates.at(-1));
    const futureDates = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date(lastDate);
      d.setDate(lastDate.getDate() + i);
      futureDates.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(d.getDate()).padStart(2, "0")}`
      );
    }

    // 更新全域日期
    window.tradingDates = [...window.originalTradingDates, ...futureDates];

    // 更新 X 軸
    const newXAxis = buildSharedXAxis();
    ApexCharts.exec("pricePane", "updateOptions", {
      xaxis: {
        ...newXAxis,
        labels: { show: false },
        axisTicks: { show: false },
      },
    });
    ApexCharts.exec("volumePane", "updateOptions", { xaxis: newXAxis });

    // 計算預測 Series
    const seriesData = buildFuture30SeriesData(
      baseClose,
      directions,
      futureDates
    );
    applyFuture30Series(seriesData);

    // Zoom 調整
    if (window.originalZoomRange) {
      ApexCharts.exec(
        "pricePane",
        "zoomX",
        window.originalZoomRange.min,
        window.originalZoomRange.max + 30
      );
      ApexCharts.exec(
        "volumePane",
        "zoomX",
        window.originalZoomRange.min,
        window.originalZoomRange.max + 30
      );
    }

    window.appState.futureAdded = true;
    futureBtn.textContent = "移除未來30天";
    futureBtn.classList.add("active");
  } else {
    // B. 移除預測
    window.tradingDates = [...window.originalTradingDates];

    // 還原 X 軸
    const newXAxis = buildSharedXAxis();
    ApexCharts.exec("pricePane", "updateOptions", {
      xaxis: {
        ...newXAxis,
        labels: { show: false },
        axisTicks: { show: false },
      },
    });
    ApexCharts.exec("volumePane", "updateOptions", { xaxis: newXAxis });

    // 移除 Series
    removeFuture30Series();

    // 還原 Zoom
    if (window.originalZoomRange) {
      ApexCharts.exec(
        "pricePane",
        "zoomX",
        window.originalZoomRange.min,
        window.originalZoomRange.max
      );
      ApexCharts.exec(
        "volumePane",
        "zoomX",
        window.originalZoomRange.min,
        window.originalZoomRange.max
      );
    }

    window.appState.futureAdded = false;
    futureBtn.textContent = "加入未來30天";
    futureBtn.classList.remove("active");
  }
}

function buildFuture30SeriesData(baseClose, directions, futureDates) {
  // 設定高度基準
  const allLows = window.stockData.map((r) => +r.low);
  const minLow = Math.min(...allLows);
  const baseY = minLow * 0.95; // 放在最低價下方

  return directions.map((dir, i) => {
    let color = "#999";
    let yVal = baseY;

    if (dir === "up") {
      color = "#e74c3c";
      yVal = baseY * 1.02;
    } else if (dir === "down") {
      color = "#2ecc71";
      yVal = baseY * 0.98;
    }

    return {
      x: futureDates[i],
      y: yVal,
      fillColor: color, // 這裡指定顏色
    };
  });
}

function applyFuture30Series(seriesData) {
  if (!window.priceChartInst) return;

  const N = window.originalTradingDates.length;
  const paddedData = [];

  // 補齊資料：歷史區段補 null，未來區段填值
  for (let i = 0; i < window.tradingDates.length; i++) {
    const date = window.tradingDates[i];
    if (i < N) {
      paddedData.push({ x: date, y: null });
    } else {
      const idx = i - N;
      paddedData.push(seriesData[idx] || { x: date, y: null });
    }
  }

  window.futurePredictionSeries = {
    name: "Future30",
    type: "bar",
    data: paddedData,
    yAxisIndex: 0,
    // ★ 移除 color 屬性，讓它依賴 data point 的 fillColor
  };

  const currentSeries = window.priceChartInst.w.config.series.filter(
    (s) => s.name !== "Future30"
  );

  window.priceChartInst.updateOptions({
    series: [...currentSeries, window.futurePredictionSeries],
    plotOptions: { bar: { columnWidth: "50%" } }, // 簡單設定就好，不要 ranges
  });
}

function removeFuture30Series() {
  if (!window.priceChartInst) return;
  const filtered = window.priceChartInst.w.config.series.filter(
    (s) => s.name !== "Future30"
  );
  window.priceChartInst.updateOptions({ series: filtered });
  window.futurePredictionSeries = null;
}

// ==========================================
// 5. 條件 Builder 邏輯整合
// ==========================================
// 拖曳相關變數
let conditionRows = [
  { id: 1, left: null, operator: ">", right: null, numberValue: null },
];
let conditionRowIdSeq = 2;

function applyConditionBuilder(silent = false) {
  const activeRow = conditionRows.find((r) => r.left);

  if (!activeRow) {
    window.appState.builderMarkers = [];
    renderAllAnnotations();
    if (!silent) alert("請設定條件");
    return;
  }

  const markers = [];
  for (let i = 0; i < window.stockData.length; i++) {
    // 判斷是否符合
    if (evaluateConditionRowAtIndex(activeRow, i)) {
      const row = window.stockData[i];
      markers.push({
        x: window.tradingDates[i], // ★ 確保使用字串
        y: parseFloat(row.low) * 0.98,
        yAxisIndex: 0,
        marker: {
          size: 6,
          fillColor: "#FF4560",
          strokeColor: "#FFF",
          shape: "circle",
        },
        label: {
          text: "Hit",
          style: { background: "#FF4560", color: "#fff" },
          offsetY: 15,
        },
      });
    }
  }

  window.appState.builderMarkers = markers;
  renderAllAnnotations();

  if (markers.length === 0 && !silent) alert("無符合條件");
}

function evaluateConditionRowAtIndex(row, i) {
  const rec = window.stockData[i];
  if (!rec || !row.left) return false;
  const leftVal = +rec[row.left.field];

  let rightVal = null;
  if (row.right) rightVal = +rec[row.right.field];
  else if (row.numberValue != null) rightVal = row.numberValue;
  else return false;

  if (isNaN(leftVal) || isNaN(rightVal)) return false;

  switch (row.operator) {
    case ">":
      return leftVal > rightVal;
    case "<":
      return leftVal < rightVal;
    case ">=":
      return leftVal >= rightVal;
    case "<=":
      return leftVal <= rightVal;
    default:
      return false;
  }
}

// ==========================================
// 6. 技術指標更新 (checkbox)
// ==========================================
function initIndicatorUpdater(baseKLineData) {
  window.updateIndicatorsFromChecked = () => {
    const checked = Array.from(
      document.querySelectorAll(".indicator-check:checked")
    ).map((cb) => cb.value);

    // 1. 基礎 K 線
    const newSeries = [
      { name: "K線圖", type: "candlestick", data: baseKLineData },
    ];

    // 2. 加入技術指標
    checked.forEach((name) => {
      // 防呆：如果使用者不小心勾選了 'volume'，要跳過，避免破壞 K 線圖刻度
      if (name.toLowerCase() === "volume") return;

      const field = name;
      const seriesData = window.stockData.map((row, i) => ({
        x: window.tradingDates[i],
        y: row[field] != null ? +row[field] : null,
      }));

      let yIdx = 0;
      if (indicatorGroups.macd.includes(name)) yIdx = 1;
      else if (indicatorGroups.kdj.includes(name)) yIdx = 2;
      else if (indicatorGroups.bias.includes(name)) yIdx = 3;

      newSeries.push({
        name: name,
        type: "line",
        data: seriesData,
        yAxisIndex: yIdx,
        color: indicatorColors[name] || "#000",
      });
    });

    // 3. 加入預測 Series (如果有)
    if (window.futurePredictionSeries) {
      newSeries.push(window.futurePredictionSeries);
    }

    // 4. 計算右側 Y 軸顯示 & ★強制設定主 Y 軸格式
    const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
    const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
    const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

    window.priceChartInst.updateOptions({
      series: newSeries,
      yaxis: [
        {
          show: true,
          seriesName: "K線圖",
          labels: {
            formatter: (v) => (typeof v === "number" ? v.toFixed(2) : v),
          }, // ★ 強制指定為小數點格式，防止出現 'M'
        },
        { show: showMacd, opposite: true, seriesName: "MACD" },
        { show: showKdj, opposite: true, seriesName: "KDJ" },
        { show: showBias, opposite: true, seriesName: "Bias" },
      ],
    });

    // 對齊 Volume
    ensureVolumeAxis();
  };

  // 綁定事件
  document.querySelectorAll(".indicator-check").forEach((cb) => {
    cb.onchange = window.updateIndicatorsFromChecked;
  });
}

// ==========================================
// Helper Functions
// ==========================================
function getSymbol() {
  return document.getElementById("symbolInput").value || "AAPL";
}

function getCheckedIndicators() {
  return Array.from(document.querySelectorAll(".indicator-check:checked")).map(
    (el) => el.value
  );
}
function restoreCheckedIndicators(list) {
  document
    .querySelectorAll(".indicator-check")
    .forEach((el) => (el.checked = list.includes(el.value)));
}

function getBuilderState() {
  return conditionRows.map((r) => ({ ...r }));
}
function restoreBuilderState(rows) {
  conditionRows =
    rows && rows.length
      ? rows
      : [{ id: 1, left: null, operator: ">", right: null, numberValue: null }];
  renderConditionRows();
}

function buildSharedXAxis() {
  return {
    type: "category",
    categories: window.tradingDates,
    tickAmount: 12,
    labels: {
      formatter: (val) => {
        if (!val || !val.includes("-")) return val;
        const [, m, d] = val.split("-");
        return `${m}/${d}`;
      },
    },
  };
}

function makeVolumeYAxis() {
  const arr = window.stockData?.map((r) => +r.volume) || [];
  const max = Math.max(...arr, 1);
  return {
    min: 0,
    max: max * (1 + VOL_PAD_TOP_RATIO),
    labels: { formatter: (val) => (val / 1000000).toFixed(1) + "M" },
  };
}

function ensureVolumeAxis() {
  if (window.volumeChartInst)
    window.volumeChartInst.updateOptions({ yaxis: makeVolumeYAxis() });
}

function customTooltip({ series, seriesIndex, dataPointIndex, w }) {
  // 你的 Tooltip 邏輯 (簡化版，請保留你原本詳細的 HTML 生成邏輯)
  const d = w.globals.initialSeries[seriesIndex].data[dataPointIndex];
  if (!d) return "";
  return `<div style="padding:5px; background:#fff; border:1px solid #ccc;">
        <div>日期: ${window.tradingDates[dataPointIndex]}</div>
        <div>數值: ${Array.isArray(d.y) ? `收: ${d.y[3]}` : d.y}</div>
    </div>`;
}

// UI: 顯示/隱藏控制面板
const controlBtn = document.getElementById("controlPanelToggle");
const controlPanel = document.getElementById("controlPanel");
if (controlBtn && controlPanel) {
  controlBtn.onclick = (e) => {
    e.preventDefault();
    controlPanel.classList.toggle("open");
  };
}

// UI: 時間區隔開關
function togglePeriods() {
  window.appState.showPeriods = !window.appState.showPeriods;
  const btn = document.getElementById("togglePeriodsBtn");
  if (btn)
    btn.textContent = window.appState.showPeriods ? "關閉區隔" : "顯示區隔";
  renderAllAnnotations();
}
window.togglePeriods = togglePeriods;

// UI: 搜尋與建議 (保留你原本邏輯)
const symbolInput = document.getElementById("symbolInput");
if (symbolInput) {
  symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") selectSymbol(symbolInput.value.toUpperCase());
  });
}
function selectSymbol(s) {
  document.getElementById("symbolInput").value = s;
  document.getElementById("suggestions").style.display = "none";
  loadStockWithRange(s, "3m");
}

// UI: Builder 渲染與事件 (簡化版)
function renderConditionRows() {
  const container = document.getElementById("conditionRowsContainer");
  if (!container) return;
  container.innerHTML = "";
  conditionRows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "rule-row";
    el.dataset.id = row.id;
    el.innerHTML = `
           <div class="drop-slot ${
             row.left ? "filled" : ""
           }" data-side="left">${row.left?.label || "指標"}</div>
           <select class="op-select">
             <option value=">">></option><option value="<"><</option>
           </select>
           <div class="drop-slot ${
             row.right ? "filled" : ""
           }" data-side="right">${row.right?.label || "數值"}</div>
           <input type="number" class="value-input" value="${
             row.numberValue || ""
           }">
           <button class="delete-row-btn">x</button>
        `;
    // 綁定事件 (省略詳細，請保留你原本的綁定邏輯)
    el.querySelector(".op-select").value = row.operator;
    el.querySelector(".op-select").onchange = (e) =>
      (row.operator = e.target.value);
    el.querySelector(".value-input").oninput = (e) =>
      (row.numberValue = parseFloat(e.target.value));
    el.querySelector(".delete-row-btn").onclick = () => {
      conditionRows = conditionRows.filter((r) => r.id !== row.id);
      renderConditionRows();
    };
    container.appendChild(el);
  });
}
// 這裡請務必呼叫你的 initConditionDragAndDrop()，保留你原本的拖曳邏輯
// ... initConditionDragAndDrop ...

// ==========================================
// 7. 拖曳功能實作 (Drag & Drop)
// ==========================================
function initConditionDragAndDrop() {
  // 1. 左邊指標 Chips：綁定 dragstart
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

  // 2. 接收區域 Drop Slot：用事件委派 (掛在 controlPanel 上)
  const panel = document.getElementById("controlPanel");
  if (!panel) return;

  // Drag Over: 允許放置
  panel.addEventListener("dragover", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    slot.classList.add("drag-over");
  });

  // Drag Leave: 移除樣式
  panel.addEventListener("dragleave", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    slot.classList.remove("drag-over");
  });

  // Drop: 處理資料
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

    // 找到對應的 row
    const rowEl = slot.closest(".rule-row");
    if (!rowEl) return;
    const rowId = Number(rowEl.dataset.id);
    const row = conditionRows.find((r) => r.id === rowId);
    if (!row) return;

    const side = slot.dataset.side; // "left" or "right"

    // 更新資料結構
    row[side] = { field: data.field, label: data.label };

    // 如果是放到右邊，清空手動輸入的數值，避免混淆
    if (side === "right") {
      row.numberValue = null;
      const valueInput = rowEl.querySelector(".value-input");
      if (valueInput) valueInput.value = "";
    }

    // 更新 UI
    slot.textContent = data.label;
    slot.classList.add("filled");

    // 重新渲染這一行 (或者也可以只更新 DOM，這裡為了保險重繪一下)
    // renderConditionRows(); // 如果覺得重繪會閃爍，可以只更新 slot 文字即可，上方已更新文字
  });
}

// ==========================================
// 8. 頁面載入初始化 (DOMContentLoaded)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // A. 預設載入股票
  loadStockWithRange("AAPL", "3m");

  // B. 綁定「搜尋」UI 互動 (展開/收合)
  const searchToggle = document.getElementById("searchToggle");
  const searchContainer = document.getElementById("searchContainer");
  const pillIcon = document.querySelector(".search-pill-icon");
  const suggestions = document.getElementById("suggestions");

  if (searchToggle && searchContainer) {
    // 點放大鏡 -> 展開
    searchToggle.addEventListener("click", () => {
      searchContainer.classList.remove("hidden");
      searchToggle.style.display = "none";
      // 關閉其他面板
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

  if (pillIcon && searchContainer) {
    // 點膠囊內圖示 -> 收合
    pillIcon.addEventListener("click", () => {
      searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";
      if (suggestions) suggestions.style.display = "none";
    });
  }

  // C. 點擊空白處關閉建議選單
  document.addEventListener("click", function (event) {
    const input = document.getElementById("symbolInput");
    if (
      suggestions &&
      !suggestions.contains(event.target) &&
      event.target !== input
    ) {
      suggestions.style.display = "none";
    }
  });

  // D. 初始化 flatpickr 日期選單
  if (window.flatpickr) {
    if (flatpickr.l10ns && flatpickr.l10ns.zh_tw) {
      flatpickr.localize(flatpickr.l10ns.zh_tw);
    }
    const commonOptions = {
      dateFormat: "Y-m-d",
      maxDate: "today",
      allowInput: false,
      onOpen: function (selectedDates, dateStr, instance) {
        // 簡單定位修正
        const cal = instance.calendarContainer;
        if (cal) {
          cal.style.zIndex = "9999";
        }
      },
    };
    flatpickr("#customStart", commonOptions);
    flatpickr("#customEnd", commonOptions);
  }

  // E. 綁定時間區間按鈕 (讓 3m 預設 active)
  const defaultBtn = document.querySelector(
    ".time-range-item[onclick*=\"'3m'\"]"
  );
  if (defaultBtn) defaultBtn.classList.add("active");

  // F. 初始化條件 Builder
  // 1. 產生第一行空白
  restoreBuilderState([]);
  // 2. 啟用拖曳監聽
  initConditionDragAndDrop();

  // G. 綁定 Builder 按鈕事件
  const addBtn = document.getElementById("addConditionRowBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      conditionRows.push({
        id: ++conditionRowIdSeq,
        left: null,
        operator: ">",
        right: null,
        numberValue: null,
      });
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
      // 重置為一行空白
      conditionRows = [
        { id: 1, left: null, operator: ">", right: null, numberValue: null },
      ];
      renderConditionRows();
      // 清除圖表標記
      applyConditionBuilder(true);
    });
  }

  // H. 綁定未來 30 天按鈕
  const futureBtn = document.getElementById("future30Btn");
  if (futureBtn) {
    futureBtn.addEventListener("click", toggleFuture30Days);
  }
});

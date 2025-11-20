
      // 後端 FastAPI 反向代理的前綴；用同源更簡單
      const API_BASE = "/api";
    
      const menuContainer = document.getElementById("menuContainer");
      const dropdownMenu = document.getElementById("dropdownMenu");

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
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
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

      // ====== ECharts 版本：上方價格/技術線 + 下方成交量（共用 MM-DD 類別軸）======

      // 成交量壓縮比例（建議 0.1~0.2）
      let VOL_PAD_TOP_RATIO = 0.12;

      // 指標顏色
      const indicatorColors = {
        "Sma_5": "#e74c3c",
        "Sma_10": "#3498db",
        "Sma_20": "#27ae60",
        "Sma_60": "#f39c12",
        "Sma_120": "#9b59b6",
        "Sma_240": "#16a085",
        DIF: "#d35400",
        DEA: "#8e44ad",
        K: "#2ecc71",
        D: "#2980b9",
        J: "#c0392b",
        Bias: "#7f8c8d",
      };

      // 指標分組 → 指定各自 y 軸
      const indicatorGroups = {
        price: ["Sma_5","Sma_10","Sma_20","Sma_60","Sma_120","Sma_240"], // yAxis 0
        bias:  ["Bias"],                                                 // yAxis 1
        macd:  ["DIF","DEA"],                                            // yAxis 2
        kdj:   ["K","D","J"],                                            // yAxis 3
      };
      const indicatorFieldMap = {
        Sma_5:"Sma_5", Sma_10:"Sma_10", Sma_20:"Sma_20", Sma_60:"Sma_60", Sma_120:"Sma_120", Sma_240:"Sma_240",
        Bias:"Bias", DIF:"DIF", DEA:"DEA", K:"K", D:"D", J:"J",
      };

      // 取得/還原/套用 checkbox（你原本的行為沿用）
      function getCheckedIndicators() {
        return Array.from(document.querySelectorAll(".indicator-check:checked")).map(el=>el.value);
      }
      function restoreCheckedIndicators(checked) {
        document.querySelectorAll(".indicator-check").forEach(el => el.checked = checked.includes(el.value));
      }
      function applyIndicators() {
        document.querySelectorAll(".indicator-check").forEach(cb => cb.onchange && cb.onchange());
      }
      function getCheckedRules() {
        return Array.from(document.querySelectorAll(".rule-check:checked")).map(el=>el.value);
      }
      function restoreCheckedRules(checked) {
        document.querySelectorAll(".rule-check").forEach(el => el.checked = checked.includes(el.value));
      }
      function applyRules() {
        document.querySelectorAll(".rule-check").forEach(cb => cb.onchange && cb.onchange());
      }

      // 數字格式
      function formatVolume(val) {
        if (val == null || isNaN(val)) return "";
        const n = +val;
        if (n >= 1e9) return (n/1e9).toFixed(0)+"B";
        if (n >= 1e6) return (n/1e6).toFixed(0)+"M";
        if (n >= 1e3) return (n/1e3).toFixed(0)+"K";
        return String(Math.round(n));
      }

      // 全域：資料 & 類別軸
      window.stockData = [];
      window.tradingDates = [];  // YYYY-MM-DD
      window.labelsMMDD   = [];  // MM-DD（顯示）
      let currentMonths = 3;
      let showPeriods = false;

      // ECharts 實例
      let priceChart = null;
      let volChart   = null;

      // 建立技術線 series（line）
      function makeLineSeries(name, field, yAxisIndex) {
        const data = window.stockData.map((row, i) =>
          row[field] != null ? [+i, +row[field]] : [i, null] // 用類別索引做 X
        );
        return {
          name,
          type: "line",
          xAxisIndex: 0,
          yAxisIndex,
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 1.5, color: indicatorColors[name] || "#000" },
          data
        };
      }

      // 依勾選重組「上方圖」所有 series
      function buildPriceSeries(chartDataIdx) {
        // K 線（candlestick 用 [open, close, low, high] 順序）
        const kSeries = {
          name: "K",
          type: "candlestick",
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: { color: "#e74c3c", color0: "#2ecc71", borderColor: "#e74c3c", borderColor0:"#2ecc71" },
          data: window.stockData.map((r, i) => [r.open, r.close, r.low, r.high])
        };

        const checked = getCheckedIndicators();
        const series = [kSeries];

        checked.forEach(name => {
          const field = indicatorFieldMap[name];
          if (!field) return;
          let yAxisIndex = 0;
          if (indicatorGroups.bias.includes(name))      yAxisIndex = 1;
          else if (indicatorGroups.macd.includes(name)) yAxisIndex = 2;
          else if (indicatorGroups.kdj.includes(name))  yAxisIndex = 3;
          series.push(makeLineSeries(name, field, yAxisIndex));
        });

        return series;
      }

      // y 軸顯示狀態
      function buildPriceYAxes() {
        const checked = getCheckedIndicators();
        const showBias = checked.some(n => indicatorGroups.bias.includes(n));
        const showMacd = checked.some(n => indicatorGroups.macd.includes(n));
        const showKdj  = checked.some(n => indicatorGroups.kdj.includes(n));
        return [
          { // 0: Price/SMA
            name: "Price/SMA", type:"value", scale:true, position:"left",
            axisLabel:{ formatter: v => Number(v).toFixed(2) }
          },
          { // 1: Bias
            name: "Bias", type:"value", position:"right", show: showBias,
            axisLabel:{ formatter: v => Number(v).toFixed(2) }, offset: 0
          },
          { // 2: MACD
            name: "MACD", type:"value", position:"right", show: showMacd,
            axisLabel:{ formatter: v => Number(v).toFixed(2) }, offset: 60
          },
          { // 3: KDJ
            name: "KDJ", type:"value", position:"right", show: showKdj,
            min: 0, max: 100, axisLabel:{ formatter: v => Number(v).toFixed(0) }, offset: 120
          }
        ];
      }

      // 成交量 y 軸
      function buildVolumeYAxis() {
        const arr = (window.stockData || []).map(r => +r.volume || 0);
        const vmax = Math.max(1, ...arr);
        const ratio = VOL_PAD_TOP_RATIO ?? 0.18;
        return {
          type: "value",
          min: 0,
          max: Math.ceil(vmax * (1 + ratio)),
          axisLabel:{ formatter: v => formatVolume(v) }
        };
      }

      // 載入 & 畫圖（主進入點）
     // 只用 ECharts，不再用 ApexCharts
    function displayStockData(rows) {
      // ---- 防呆 ----
      if (!window.echarts) {
        alert("ECharts 未載入（請先在 index.html 引入 echarts.min.js 並在 app.js 之前）");
        return;
      }
      const priceEl = document.getElementById("priceChart");
      const volEl   = document.getElementById("volumeChart");
      if (!priceEl || !volEl) {
        console.error("找不到 #priceChart 或 #volumeChart 容器");
        return;
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        alert("查無資料");
        return;
      }

      // ---- 小工具：時間處理 ----
      const fmtMMDD = (ts) => {
        const d = new Date(ts);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${mm}/${dd}`;
      };
      const toTs = (t) => {
        if (typeof t === "number") return t < 1e12 ? t * 1000 : t; // 秒→毫秒
        return new Date(t).getTime();
      };

      // ---- 清理 & 排序 ----
      const cleaned = rows.map((r) => ({
          time:   toTs(r.time ?? r.date ?? r.timestamp),
          open:   +r.open,
          high:   +r.high,
          low:    +r.low,
          close:  +r.close,
          volume: +(r.volume ?? 0),
        }))
        .filter(r =>
          Number.isFinite(r.time) &&
          Number.isFinite(r.open) &&
          Number.isFinite(r.high) &&
          Number.isFinite(r.low)  &&
          Number.isFinite(r.close)
        )
        .sort((a,b) => a.time - b.time);

      if (!cleaned.length) {
        alert("資料格式不符合（缺 open/high/low/close/time）");
        return;
      }

      // ---- 準備資料 ----
      const kData = cleaned.map(r => [r.time, r.open, r.close, r.low, r.high]); // [t,o,c,l,h]
      const vData = cleaned.map(r => [r.time, r.volume]);

      const vmax = Math.max(1, ...cleaned.map(r => r.volume || 0));
      const vpad = window.VOL_PAD_TOP_RATIO ?? 0.18;

      // ---- 取得/建立實例 ----
      const priceChart  = echarts.getInstanceByDom(priceEl)  || echarts.init(priceEl);
      const volumeChart = echarts.getInstanceByDom(volEl)    || echarts.init(volEl);

      // ---- 共用 dataZoom ----
      const dz = [
        { type: "inside", xAxisIndex: 0, throttle: 50 },
        { type: "slider", xAxisIndex: 0, height: 20, bottom: 0 },
      ];

      // ---- 價格圖 ----
      const priceOption = {
        animation: false,
        grid: { left: 50, right: 20, top: 10, bottom: 30 },
        xAxis: {
          type: "time",
          boundaryGap: true,
          axisLabel: { show: false }, // 不顯示，但仍對齊
          axisPointer: { label: { formatter: (p) => fmtMMDD(p.value) } },
        },
        yAxis: {
          scale: true,
          splitLine: { show: true },
          axisLabel: { formatter: (v) => Number(v).toFixed(2) },
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross" },
          formatter: (params) => {
            const p = params[0];
            const r = cleaned[p.dataIndex];
            return [
              `<div>${fmtMMDD(r.time)}</div>`,
              `O: ${r.open}`,
              `H: ${r.high}`,
              `L: ${r.low}`,
              `C: ${r.close}`,
            ].join("<br>");
          },
        },
        dataZoom: dz,
        series: [{
          name: "K",
          type: "candlestick",
          data: kData, // [time, open, close, low, high]
          itemStyle: {
            color: "#ef4444",      // 漲
            color0: "#22c55e",     // 跌
            borderColor: "#ef4444",
            borderColor0: "#22c55e",
          },
        }],
      };

      // ---- 成交量圖 ----
      const volumeOption = {
        animation: false,
        grid: { left: 50, right: 20, top: 10, bottom: 30 },
        xAxis: {
          type: "time",
          boundaryGap: true,
          axisLabel: { formatter: (val) => fmtMMDD(val) },
          axisPointer: { label: { formatter: (p) => fmtMMDD(p.value) } },
        },
        yAxis: {
          min: 0,
          max: Math.ceil(vmax * (1 + vpad)),
          splitLine: { show: true },
          axisLabel: {
            formatter: (val) => {
              if (val >= 1e9) return (val/1e9).toFixed(0) + "B";
              if (val >= 1e6) return (val/1e6).toFixed(0) + "M";
              if (val >= 1e3) return (val/1e3).toFixed(0) + "K";
              return val;
            }
          }
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross" },
          formatter: (params) => {
            const p = params[0];
            const r = cleaned[p.dataIndex];
            return `<div>${fmtMMDD(r.time)}</div>Volume: ${r.volume}`;
          },
        },
        dataZoom: dz,
        series: [{
          name: "Volume",
          type: "bar",
          data: vData,
          itemStyle: {
            color: (p) => {
              const r = cleaned[p.dataIndex];
              return r.close >= r.open ? "#ef4444" : "#22c55e";
            },
          },
        }],
      };

      priceChart.setOption(priceOption, true);
      volumeChart.setOption(volumeOption, true);

      // 同步互動
      echarts.connect([priceChart, volumeChart]);

      // 自適應
      const onResize = () => { priceChart.resize(); volumeChart.resize(); };
      window.removeEventListener("resize", onResize);
      window.addEventListener("resize", onResize);
    }



      // 高亮條件：用 markPoint 畫倒三角 + 文字
      function highlightConditions(rules) {
        if (!window.stockData?.length) return;

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

        const points = [];
        for (let i=2;i<window.stockData.length;i++){
          const row  = window.stockData[i];
          const prev = window.stockData[i-1];
          const prev2= window.stockData[i-2];

          const sma5 = +row["Sma_5"],  sma20=+row["Sma_20"];
          const ps5 = +prev["Sma_5"],  ps20=+prev["Sma_20"];
          const macd = +row["DIF"],    macdS=+row["DEA"];
          const pm = +prev["DIF"],     pms= +prev["DEA"];
          const k = +row["K"],         d = +row["D"];
          const pk= +prev["K"],        pd= +prev["D"];
          const bias= +row["Bias"];

          const checks = {
            "sma-cross":        ()=> ps5 < ps20 && sma5 >= sma20,
            "dif-above-dea":    ()=> pm  < pms  && macd >= macdS,
            "dea-below-dif":    ()=> pms < pm   && macdS >= macd,
            "kd-cross":         ()=> pk < pd && k >= d && k < 20,
            "bias-high":        ()=> bias > 5,
            "bias-low":         ()=> bias < -5,
            "three-red":        ()=> [row,prev,prev2].every(r=> +r.close > +r.open),
            "three-down-volume":()=> row.volume < prev.volume && prev.volume < prev2.volume,
          };

          if (!rules.length) continue;

          let pass = false, text = "";
          if (rules.length === 1) {
            const r0 = rules[0];
            pass = checks[r0] && checks[r0]();
            text = labelMap[r0] || "";
          } else {
            pass = rules.every(r=> checks[r] && checks[r]());
            text = rules.map(r=>labelMap[r]).join("");
          }
          if (pass) {
            points.push({
              coord: [i, Math.min(row.open,row.close,row.low) * 0.98], // 取較低處
              symbol: "triangle",
              symbolRotate: 180,
              symbolSize: 10,
              itemStyle: { color: "#000" },
              label: { show:true, position:"bottom", color:"#000", fontWeight:"bold", formatter: text }
            });
          }
        }

        // 將 markPoint 套到 K 線（series[0]）
        priceChart.setOption({
          series: [{ // 只覆蓋第一個 series 的 markPoint
            name: "K",
            markPoint: {
              symbol: "triangle",
              symbolRotate: 180,
              data: points
            }
          }]
        });
      }

      // 加分隔線（季度/月份）：用 markLine 畫直線 + markPoint 放 Q1/Q2…
      function addPeriodSeparators(periodMonths) {
        if (!window.tradingDates?.length) return;

        // 1 個月不畫
        if (periodMonths === 1) {
          priceChart.setOption({ series: [{ name:"K", markLine: { data: [] }}, { }] });
          return;
        }
        const start = new Date(window.tradingDates[0]);
        const end   = new Date(window.tradingDates[window.tradingDates.length-1]);
        const total = end - start; if (total<=0) return;

        let sections, labels;
        if (periodMonths >= 12) { sections=4; labels=["Q1","Q2","Q3","Q4"]; }
        else { sections = periodMonths; labels = Array.from({length:sections},(_,i)=>String(i+1)); }

        const interval = total / sections;
        const lines = [];
        const mids  = [];

        for (let i=0;i<sections;i++){
          const sectionStart = new Date(start.getTime() + interval*i);
          const sectionEnd   = new Date(start.getTime() + interval*(i+1));
          const mid = new Date((sectionStart*1 + sectionEnd*1)/2);

          let midIdx = window.tradingDates.findIndex(d => new Date(d).getTime() >= mid.getTime());
          if (midIdx === -1) midIdx = window.tradingDates.length-1;

          mids.push({
            coord: [midIdx, null],
            label: { show:true, formatter: labels[i], color:"#000", fontWeight:"bold" },
            symbolSize: 1
          });

          if (i < sections-1) {
            let lineIdx = window.tradingDates.findIndex(d => new Date(d).getTime() >= sectionEnd.getTime());
            if (lineIdx !== -1 && lineIdx < window.tradingDates.length) {
              lines.push([{ xAxis: lineIdx-0.5 }, { xAxis: lineIdx-0.5 }]);
            }
          }
        }

        priceChart.setOption({
          series: [{
            name:"K",
            markLine: {
              silent: true,
              lineStyle: { color:"#999", type:"dashed" },
              data: lines
            },
            markPoint: { // 保留原本條件標註，再疊加 period 標籤
              data: (priceChart.getOption()?.series?.[0]?.markPoint?.data || []).concat(mids)
            }
          }]
        });
      }

      // 時間切換（沿用你的 API 與流程）
      async function loadStockWithRange(symbol, range) {
        const checkedIndicatorsBefore = getCheckedIndicators();
        const checkedRulesBefore = getCheckedRules();

        if (range === "custom") {
          const start = document.getElementById("customStart").value;
          const end   = document.getElementById("customEnd").value;
          if (!start || !end) return alert("請先選擇起訖日期");
          const url = `${API_BASE}/stocks/range?symbol=${encodeURIComponent(symbol)}&start=${start}&end=${end}`;
          const resp = await fetch(url);
          if (!resp.ok) return alert("查詢失敗");
          const data = await resp.json();
          if (!data?.length) return alert("查無資料");
          displayStockData(data, symbol);
          restoreCheckedIndicators(checkedIndicatorsBefore); applyIndicators();
          restoreCheckedRules(checkedRulesBefore);           applyRules();
          return;
        }

        const rangeToCount = { "5d":5, "1m":22, "3m":66, "6m":132, "1y":264, "3y":792 };
        let count = rangeToCount[range] || 264;
        if (range === "ytd") {
          const today = new Date();
          const startOfYear = new Date(today.getFullYear(),0,1);
          const diffDays = Math.ceil(Math.abs(today - startOfYear) / (1000*60*60*24));
          count = diffDays;
        }

        const url = `${API_BASE}/stocks?symbol=${encodeURIComponent(symbol)}&count=${count}`;
        const resp = await fetch(url);
        if (!resp.ok) return alert("查詢失敗");
        const data = await resp.json();
        if (!data?.length) return alert("查無資料");

        displayStockData(data, symbol);
        restoreCheckedIndicators(checkedIndicatorsBefore); applyIndicators();
        restoreCheckedRules(checkedRulesBefore);           applyRules();
      }

      // 時間功能列（維持你原本的 active 樣式與 months 計算）
      function setActive(el, range) {
        document.querySelectorAll(".time-range-item").forEach(item => item.classList.remove("active"));
        el.classList.add("active");
        document.getElementById("customDateRange").style.display = "none";

        loadStockWithRange(getSymbol(), range).then(() => {
          let months = 3;
          if (range === "1m") months = 1;
          if (range === "3m") months = 3;
          if (range === "6m") months = 6;
          if (range === "1y") months = 12;
          if (range === "3y") months = 36;
          currentMonths = months;
          if (showPeriods) addPeriodSeparators(months);
        });
      }

      // 量軸比例調整（滑桿）
      function updateVolRatio(value) {
        VOL_PAD_TOP_RATIO = parseFloat(value);
        const label = document.getElementById("volRatioValue");
        if (label) label.textContent = value;

        if (volChart && window.stockData?.length) {
          volChart.setOption({ yAxis: buildVolumeYAxis() });
        }
      }

      // 顯示/隱藏分隔線
      function togglePeriods() {
        showPeriods = document.getElementById("togglePeriods").checked;
        if (showPeriods) addPeriodSeparators(currentMonths);
        else {
          priceChart.setOption({ series:[{ name:"K", markLine:{ data:[] }, markPoint:{ data:[] } }] });
        }
      }

      // 初始化 checkbox 標籤顏色（沿用你原本邏輯）
      document.querySelectorAll(".indicator-check").forEach((cb) => {
        const color = indicatorColors[cb.value];
        if (color) {
          cb.parentElement.style.color = color;
          cb.dataset.color = color;
        }
      });

      // 頁面載入預設
      document.addEventListener("DOMContentLoaded", () => {
        loadStockWithRange("AAPL", "3m");
      });

    
import yfinance as yf
import pandas_ta as ta
import pandas as pd
import math
from supabase import create_client

#  Supabase 連線設定
SUPABASE_URL = "https://sbzzfjlmhvuchzwqllgf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNienpmamxtaHZ1Y2h6d3FsbGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NDE2OTQsImV4cCI6MjA2ODMxNzY5NH0.fvDVLvGLQdMRuCMXmja8ltpXC3TcjZxq78xbnt9Bh-U"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 股票清單
US_STOCK_NAME = [
    'AAPL', 'AMGN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS',
    'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK',
    'MSFT', 'NKE', 'PG', 'TRV', 'UNH', 'V', 'VZ', 'WBA', 'WMT'
]

# 安全處理函式：NaN / inf / -inf → None，其餘數字四捨五入到小數 10 位


def safe_value(v):
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 10)
    return v


#  技術指標抓取與上傳
for symbol in US_STOCK_NAME:
    print(f"抓取 {symbol} 資料中...")
    stock = yf.Ticker(symbol)
    hist = stock.history(start="2015-01-01")

    # ===== 技術指標 =====
    hist["Volume_Percentage"] = hist["Volume"].pct_change() * 100
    hist["Sma_5"] = ta.sma(hist["Close"], length=5)
    hist["Sma_10"] = ta.sma(hist["Close"], length=10)
    hist["Sma_20"] = ta.sma(hist["Close"], length=20)
    hist["Sma_60"] = ta.sma(hist["Close"], length=60)
    hist["Sma_120"] = ta.sma(hist["Close"], length=120)
    hist["Sma_240"] = ta.sma(hist["Close"], length=240)

    #  MACD → DIF 與 DEA
    macd_df = ta.macd(hist["Close"])
    hist["DIF"] = macd_df["MACD_12_26_9"]      # DIF 快線
    hist["DEA"] = macd_df["MACDs_12_26_9"]     # DEA 慢線 (Signal)

    stoch = ta.stoch(hist["High"], hist["Low"], hist["Close"])
    hist["K"] = stoch["STOCHk_14_3_3"]
    hist["D"] = stoch["STOCHd_14_3_3"]
    hist["J"] = 3 * hist["K"] - 2 * hist["D"]
    hist["Atr"] = ta.atr(hist["High"], hist["Low"], hist["Close"], length=14)
    hist["Cci"] = ta.cci(hist["High"], hist["Low"], hist["Close"], length=20)
    hist["Mom_6"] = ta.mom(hist["Close"], length=6)
    hist["Mom_10"] = ta.mom(hist["Close"], length=10)
    hist["Mom_12"] = ta.mom(hist["Close"], length=12)
    hist["Mom_18"] = ta.mom(hist["Close"], length=18)
    hist["Roc_5"] = ta.roc(hist["Close"], length=5)
    hist["Roc_10"] = ta.roc(hist["Close"], length=10)
    hist["Roc_12"] = ta.roc(hist["Close"], length=12)
    hist["Willr"] = ta.willr(hist["High"], hist["Low"],
                             hist["Close"], length=14)
    hist["Bias"] = (hist["Close"] - hist["Sma_20"]) / hist["Sma_20"] * 100
    short_ma = hist["Volume"].rolling(window=5).mean()
    long_ma = hist["Volume"].rolling(window=20).mean()
    hist["Volume_Oscillator"] = (short_ma - long_ma) / long_ma * 100

    #  整理並批量上傳
    batch_data = []
    for index, row in hist.iterrows():
        data = {
            "symbol": symbol,
            "date": index.date().isoformat(),
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": int(row["Volume"]),
            "Volume Percentage": row["Volume_Percentage"],
            "Sma 5": row["Sma_5"],
            "Sma 10": row["Sma_10"],
            "Sma 20": row["Sma_20"],
            "Sma 60": row["Sma_60"],
            "Sma 120": row["Sma_120"],
            "Sma 240": row["Sma_240"],
            "DIF": row["DIF"],
            "DEA": row["DEA"],
            "K": row["K"],
            "D": row["D"],
            "J": row["J"],
            "Atr": row["Atr"],
            "Cci": row["Cci"],
            "Mom 6": row["Mom_6"],
            "Mom 10": row["Mom_10"],
            "Mom 12": row["Mom_12"],
            "Mom 18": row["Mom_18"],
            "Roc 5": row["Roc_5"],
            "Roc 10": row["Roc_10"],
            "Roc 12": row["Roc_12"],
            "Willr": row["Willr"],
            "Bias": row["Bias"],
            "Volume Oscillator": row["Volume_Oscillator"]
        }

        # 套用 safe_value，確保沒有 NaN / inf
        clean_data = {}
        for k, v in data.items():
            val = safe_value(v)
            # if v is not None and isinstance(v, float) and not math.isfinite(v):
            #     print(f" {symbol} {index.date()} 欄位 {k} 出現異常數值: {v}")
            clean_data[k] = val

        batch_data.append(clean_data)

    #  每 500 筆分批上傳
    for i in range(0, len(batch_data), 500):
        print(f"寫入 {symbol} 第 {i} ~ {i+500} 筆")
        supabase.table("stocks").insert(batch_data[i:i+500]).execute()

print("全部股票寫入完成")

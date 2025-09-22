import yfinance as yf
import pandas_ta as ta
import pandas as pd
import datetime
from supabase import create_client
import os
import math

# Supabase 連線設定
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
    if v is None or pd.isna(v):
        return None
    if isinstance(v, (int, pd.Int64Dtype,)):
        return int(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        # 如果這個 float 其實是整數（像 163470300.0），轉 int
        if v.is_integer():
            return int(v)
        return round(v, 10)
    return v


# 抓最近 35 天資料（技術指標需要長期資料）
end_date = datetime.datetime.now().date()
start_date = end_date - datetime.timedelta(days=365)

# 技術指標抓取與上傳
for symbol in US_STOCK_NAME:
    print(f"Fetch  {symbol} data...")
    stock = yf.Ticker(symbol)
    hist = stock.history(start=start_date, end=end_date)

    if hist.empty or len(hist) < 20:
        print(f"{symbol} 資料不足，跳過")
        continue

    # 計算技術指標
    hist["Volume_Percentage"] = hist["Volume"].pct_change() * 100
    hist["Sma_5"] = ta.sma(hist["Close"], length=5)
    hist["Sma_10"] = ta.sma(hist["Close"], length=10)
    hist["Sma_20"] = ta.sma(hist["Close"], length=20)
    hist["Sma_60"] = ta.sma(hist["Close"], length=60)
    hist["Sma_120"] = ta.sma(hist["Close"], length=120)
    hist["Sma_240"] = ta.sma(hist["Close"], length=240)

    macd_df = ta.macd(hist["Close"])
    hist["DIF"] = macd_df["MACD_12_26_9"] if macd_df is not None else None
    hist["DEA"] = macd_df["MACDs_12_26_9"]  # DEA 慢線 (Signal)

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

    # 只上傳今天那一筆
    today_row = hist.iloc[-1]
    today_date = today_row.name.date()

    data = {
        "symbol": symbol,
        "date": today_date.isoformat(),
        "open": safe_value(today_row["Open"]),
        "high": safe_value(today_row["High"]),
        "low": safe_value(today_row["Low"]),
        "close": safe_value(today_row["Close"]),
        "volume": safe_value(today_row["Volume"]),
        "Volume Percentage": safe_value(today_row["Volume_Percentage"]),
        "Sma 5": safe_value(today_row["Sma_5"]),
        "Sma 10": safe_value(today_row["Sma_10"]),
        "Sma 20": safe_value(today_row["Sma_20"]),
        "Sma 60": safe_value(today_row["Sma_60"]),
        "Sma 120": safe_value(today_row["Sma_120"]),
        "Sma 240": safe_value(today_row["Sma_240"]),
        "DIF": safe_value(today_row["DIF"]),
        "DEA": safe_value(today_row["DEA"]),
        "K": safe_value(today_row["K"]),
        "D": safe_value(today_row["D"]),
        "J": safe_value(today_row["J"]),
        "Atr": safe_value(today_row["Atr"]),
        "Cci": safe_value(today_row["Cci"]),
        "Mom 6": safe_value(today_row["Mom_6"]),
        "Mom 10": safe_value(today_row["Mom_10"]),
        "Mom 12": safe_value(today_row["Mom_12"]),
        "Mom 18": safe_value(today_row["Mom_18"]),
        "Roc 5": safe_value(today_row["Roc_5"]),
        "Roc 10": safe_value(today_row["Roc_10"]),
        "Roc 12": safe_value(today_row["Roc_12"]),
        "Willr": safe_value(today_row["Willr"]),
        "Bias": safe_value(today_row["Bias"]),
        "Volume Oscillator": safe_value(today_row["Volume_Oscillator"])
    }

    # 檢查今天資料是否已存在
    existing = supabase.table("stocks") \
        .select("id") \
        .eq("symbol", symbol) \
        .eq("date", today_date.isoformat()) \
        .execute()

    if existing.data and len(existing.data) > 0:
        print(f" {symbol} {today_date} PASS")
    else:
        supabase.table("stocks").insert(data).execute()
        print(f" {symbol} {today_date} WRITE IN")

print("fetch data done")

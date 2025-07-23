import yfinance as yf
import pandas_ta as ta
import pandas as pd
import datetime
from supabase import create_client
import os

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

# 抓最近 35 天資料（技術指標需要長期資料）
end_date = datetime.datetime.now().date()
start_date = end_date - datetime.timedelta(days=365)

# 技術指標抓取與上傳
for symbol in US_STOCK_NAME:
    print(f"抓取 {symbol} 資料中...")
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
    hist["Macd"] = macd_df["MACD_12_26_9"] if macd_df is not None else None

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
    today_row = hist.iloc[-3]
    today_date = today_row.name.date()

    data = {
        "symbol": symbol,
        "date": today_date.isoformat(),
        "open": float(today_row["Open"]),
        "high": float(today_row["High"]),
        "low": float(today_row["Low"]),
        "close": float(today_row["Close"]),
        "volume": int(today_row["Volume"]),
        "Volume Percentage": today_row["Volume_Percentage"],
        "Sma 5": today_row["Sma_5"],
        "Sma 10": today_row["Sma_10"],
        "Sma 20": today_row["Sma_20"],
        "Sma 60": today_row["Sma_60"],
        "Sma 120": today_row["Sma_120"],
        "Sma 240": today_row["Sma_240"],
        "Macd": today_row["Macd"],
        "K": today_row["K"],
        "D": today_row["D"],
        "J": today_row["J"],
        "Atr": today_row["Atr"],
        "Cci": today_row["Cci"],
        "Mom 6": today_row["Mom_6"],
        "Mom 10": today_row["Mom_10"],
        "Mom 12": today_row["Mom_12"],
        "Mom 18": today_row["Mom_18"],
        "Roc 5": today_row["Roc_5"],
        "Roc 10": today_row["Roc_10"],
        "Roc 12": today_row["Roc_12"],
        "Willr": today_row["Willr"],
        "Bias": today_row["Bias"],
        "Volume Oscillator": today_row["Volume_Oscillator"]
    }

    # 轉換 NaN ➜ None，並限制浮點數位數
    data = {k: (None if pd.isna(v) else round(v, 10) if isinstance(v, float) else v)
            for k, v in data.items()}

    supabase.table("stocks").insert(data).execute()

print("每日股票更新完成")

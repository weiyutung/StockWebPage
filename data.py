from supabase import create_client, Client
import yfinance as yf
import pandas as pd  # ✅ 加上這行

# Supabase 連線設定
url = "https://cqtfffupninvnbxkbgjv.supabase.co"
key = "你的 Supabase 金鑰"
supabase: Client = create_client(url, key)

# 股票清單
US_STOCK_NAME = [
    'AAPL', 'AMGN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS',
    'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK',
    'MSFT', 'NKE', 'PG', 'TRV', 'UNH', 'V', 'VZ', 'WBA', 'WMT'
]

# 抓資料並寫入 Supabase
for symbol in US_STOCK_NAME:
    print(f"抓取 {symbol} 資料中...")

    hist = yf.download(
        symbol,
        start='2010-01-01',
        end='2022-12-31',
        interval='1d',
        auto_adjust=False  # ✅ 保留原始價格
        # ✅ 不使用 group_by='ticker'，避免 MultiIndex 問題
    )

    if hist.empty:
        print(f"⚠️ {symbol} 無資料，略過")
        continue

    for index, row in hist.iterrows():
        # ✅ 正確檢查是否有缺失值
        if pd.isnull(row[["Open", "High", "Low", "Close", "Volume"]]).any():
            continue

        data = {
            "symbol": symbol,
            "date": index.date().isoformat(),
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": int(row["Volume"])
        }

        supabase.table("stocks").insert([data]).execute()

print("✅ 全部股票寫入完成")

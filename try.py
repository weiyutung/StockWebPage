import yfinance as yf
from supabase import create_client

# ✅ Supabase 連線設定
SUPABASE_URL = "https://sbzzfjlmhvuchzwqllgf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNienpmamxtaHZ1Y2h6d3FsbGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NDE2OTQsImV4cCI6MjA2ODMxNzY5NH0.fvDVLvGLQdMRuCMXmja8ltpXC3TcjZxq78xbnt9Bh-U"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ✅ 股票清單
US_STOCK_NAME = [
    'AAPL', 'AMGN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS',
    'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK',
    'MSFT', 'NKE', 'PG', 'TRV', 'UNH', 'V', 'VZ', 'WBA', 'WMT'
]

# ✅ 逐支股票抓資料並寫入 Supabase
for symbol in US_STOCK_NAME:
    print(f"抓取 {symbol} 資料中...")
    stock = yf.Ticker(symbol)
    hist = stock.history(period="5d")

    for index, row in hist.iterrows():
        data = {
            "symbol": symbol,
            "date": index.date().isoformat(),
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": int(row["Volume"])
        }
        supabase.table("stocks").insert(data).execute()

print(" 全部股票寫入完成")

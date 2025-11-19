
import mysql.connector
from mysql.connector import Error

def main():
    try:
        conn = mysql.connector.connect(
            host="localhost",
            port=3306,
            user="root",
            password="1135j0 wu6b05",   # 你的密碼（含空白沒問題）
            database="stockboard",      # 你的資料庫
        )
        cur = conn.cursor()

        cur.execute("CREATE DATABASE IF NOT EXISTS qq;")
        print("資料庫 qq 建立成功或已存在")
    except Error as e:
        print("連線失敗 / 查詢錯誤：", e)

if __name__ == "__main__":
    main()

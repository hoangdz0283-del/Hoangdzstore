from app.database import engine, DB_HOST, DB_USER, DB_NAME

print("HOST:", repr(DB_HOST))
print("USER:", repr(DB_USER))
print("DATABASE:", repr(DB_NAME))

try:
    connection = engine.connect()
    print("KET NOI MYSQL THANH CONG!")
    connection.close()
except Exception as e:
    print("KET NOI THAT BAI:", e)
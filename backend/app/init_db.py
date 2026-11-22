
from app.database import engine, Base
from app import models

Base.metadata.create_all(bind=engine)

print("DA TAO CAC BANG MYSQL THANH CONG!")
print("- products")
print("- users")
print("- orders")
print("- order_items")

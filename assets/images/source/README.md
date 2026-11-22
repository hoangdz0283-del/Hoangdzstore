# Thu vien anh nguon san pham

Thu muc nay luu anh nguon theo thuong hieu va model. Website chi hien thi anh
duoc khai bao trong `assets/images/manifest.js`; hien co 31 anh nguon da duoc
anh xa theo Product ID.

## Thu muc thuong hieu

- `apple/` — anh san pham Apple.
- `samsung/` — anh san pham Samsung.
- `asus/` — anh san pham ASUS.
- `lg/` — anh san pham LG.
- `lenovo/` — anh san pham Lenovo.
- `sony/` — anh san pham Sony.

## Cach them anh

1. Chon dung thu muc thuong hieu.
2. Doi chieu ten/model trong catalog; dat ten theo ID san pham, khong theo thu tu
   trong danh sach. Vi du: `product-12.jpg` hoac `product-12-front.jpg`.
3. Cac dinh dang nen dung: `.jpg`, `.jpeg`, `.png` hoac `.webp`.
4. Giu nguyen ban goc tai day. Khong ghi de anh da co; neu can them goc chup,
   them hau to mo ta nhu `-front`, `-back` hoac `-detail`.
5. Chi dung anh dung model va co quyen su dung phu hop. Luu lai URL nguon, tac
   gia, giay phep va yeu cau ghi cong de cung cap khi tich hop.
6. Khong dung anh minh hoa, anh AI hoac anh khong ro model de thay cho anh that.

Anh nguon da duoc anh xa se hien thi tren website ma khong can sao chep hay sua
database. Anh moi chi hien thi sau khi duoc doi chieu va cap nhat manifest.

## Cau truc thuong hieu va dong san pham

Dat anh trong dung thu muc dong san pham ben duoi. Dung ten `product-<ID>.<ext>`
de anh co the doi chieu voi catalog. Cac ten file trong bang la vi du; anh tham
khao do nguoi dung cung cap duoc liet ke rieng trong
[PRODUCT_IMAGE_DIRECTORY.md](./PRODUCT_IMAGE_DIRECTORY.md).

```text
source/
|-- apple/{iphone,macbook,ipad,airpods,apple-watch}/
|-- samsung/{galaxy-s,galaxy-a,galaxy-z,galaxy-tab,galaxy-buds,galaxy-watch}/
|-- asus/{zenbook,vivobook,rog,tuf,proart}/
|-- lg/{gram,ultragear,oled-tv,xboom}/
|-- lenovo/{thinkpad,yoga,loq,legion,tab}/
|-- sony/{headphones,cameras,other}/
```

## Doi chieu catalog 34 san pham

Bang duoi day la doi chieu theo dong san pham voi API hien tai. Bang thu muc
theo model va product ID chi tiet nam trong [PRODUCT_IMAGE_DIRECTORY.md](./PRODUCT_IMAGE_DIRECTORY.md).
Neu chua ro dong/model, khong tu gan anh vao mot dong gan giong.

| Product ID | Ten file mau | Thuong hieu | Dong san pham / thu muc | Model trong catalog |
|---:|---|---|---|---|
| 1 | `apple/iphone/product-1.jpg` | Apple | iPhone | iPhone 16 Pro Max |
| 2 | `apple/macbook/product-2.jpg` | Apple | MacBook | MacBook Pro M4 |
| 3 | `apple/airpods/product-3.jpg` | Apple | AirPods | AirPods Pro; chua ro the he |
| 4 | `apple/ipad/product-4.jpg` | Apple | iPad | iPad Pro; chua ro the he/kich thuoc |
| 5 | `apple/macbook/product-5.jpg` | Apple | MacBook | MacBook Air M3 |
| 6 | `sony/headphones/product-6.jpg` | Sony | Headphones | Tai nghe Sony; chua ro model |
| 7 | `apple/apple-watch/product-7.jpg` | Apple | Apple Watch | Apple Watch; chua ro model/the he |
| 8 | `unknown/wireless-charger-unknown-brand-model/product-8-user-provided.png` | Chua xac dinh | Chua xac dinh | Sac khong day; chua ro thuong hieu/model |
| 9 | `apple/iphone/product-9.jpg` | Apple | iPhone | iPhone 16 128GB |
| 10 | `apple/mac-mini-m4-16gb-256gb/product-10.jpg` | Apple | Mac mini | Mac mini M4 16GB/256GB |
| 11 | `samsung/galaxy-s/product-11.jpg` | Samsung | Galaxy S | Galaxy S25 Ultra 256GB |
| 12 | `samsung/galaxy-s/product-12.jpg` | Samsung | Galaxy S | Galaxy S25 256GB |
| 13 | `samsung/galaxy-a/product-13.jpg` | Samsung | Galaxy A | Galaxy A56 5G 256GB |
| 14 | `samsung/galaxy-z/product-14.jpg` | Samsung | Galaxy Z | Galaxy Z Flip6 256GB |
| 15 | `samsung/galaxy-tab/product-15.jpg` | Samsung | Galaxy Tab | Galaxy Tab S10 FE 128GB |
| 16 | `samsung/galaxy-buds/product-16.jpg` | Samsung | Galaxy Buds | Galaxy Buds3 Pro |
| 17 | `samsung/galaxy-watch/product-17.jpg` | Samsung | Galaxy Watch | Galaxy Watch7 44mm |
| 18 | `asus/zenbook/product-18.jpg` | ASUS | Zenbook | Zenbook S 14 UX5406 32GB/1TB |
| 19 | `asus/vivobook/product-19.jpg` | ASUS | Vivobook | Vivobook S 14 OLED M5406 16GB/1TB |
| 20 | `asus/rog/product-20.jpg` | ASUS | ROG | ROG Zephyrus G14 GA403 |
| 21 | `asus/tuf/product-21.jpg` | ASUS | TUF | TUF Gaming A15 FA507 16GB/512GB |
| 22 | `asus/rog/product-22.jpg` | ASUS | ROG | ROG Ally X 2024 |
| 23 | `asus/proart/product-23.jpg` | ASUS | ProArt | ProArt Display PA278QV |
| 24 | `lg/gram/product-24.jpg` | LG | gram | LG gram 14 2024 16GB/512GB |
| 25 | `lg/ultragear/product-25.jpg` | LG | UltraGear | LG UltraGear 27GS75Q-B |
| 26 | `lg/oled-tv/product-26.jpg` | LG | OLED TV | LG OLED evo C4 55 inch |
| 27 | `lg/xboom/product-27.jpg` | LG | XBOOM | LG XBOOM Go XG2 |
| 28 | `lg/gram/product-28.jpg` | LG | gram | LG gram +view 16MR70 (man hinh di dong) |
| 29 | `lenovo/thinkpad/product-29.jpg` | Lenovo | ThinkPad | ThinkPad X1 Carbon Gen 12 32GB/1TB |
| 30 | `lenovo/yoga/product-30.jpg` | Lenovo | Yoga | Yoga Slim 7x 14Q8X9 16GB/512GB |
| 31 | `lenovo/loq/product-31.jpg` | Lenovo | LOQ | LOQ 15AHP9 16GB/512GB |
| 32 | `lenovo/legion/product-32.jpg` | Lenovo | Legion | Legion Go 8APU1 16GB/512GB |
| 33 | `lenovo/ideapad-slim-5-14imh9-16gb-512gb/product-33.jpg` | Lenovo | IdeaPad | IdeaPad Slim 5 14IMH9 16GB/512GB |
| 34 | `lenovo/tab/product-34.jpg` | Lenovo | Tab | Tab P12 8GB/128GB |

ID 8 da co thu muc rieng `unknown/` de giu mapping ma khong gan sai thuong hieu;
ID 10 va 33 co thu muc theo model trong bang chi tiet. ID 3, 4, 6, 7 va 8 van
thieu mot phan thong tin model/thuong hieu de chon anh that chinh xac.

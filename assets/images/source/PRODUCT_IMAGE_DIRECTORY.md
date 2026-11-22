# HOANGDZ STORE — Product image directory

Catalog source: read-only `GET http://127.0.0.1:8001/api/products` (34 records).
Image folder paths in the table are relative to `assets/images/source/`.
The table preserves catalog names and IDs. A named model below means the API
states that model; it does not claim that a manufacturer's full SKU, color, or
commercial photo rights were independently verified. 31 user-provided images
are referenced by the storefront manifest using product ID and product-specific
folder. The user confirmed display authorization; exact photo variants and
specific license/credit terms were not independently verified.

| Product ID | Brand | Product name | Model | Image folder | Verification status |
|---:|---|---|---|---|---|
| 1 | Apple | iPhone 16 Pro Max | iPhone 16 Pro Max | `apple/iphone-16-pro-max/` | Model stated in API; color/configuration incomplete |
| 2 | Apple | MacBook Pro M4 | MacBook Pro M4 | `apple/macbook-pro-m4/` | Model stated in API; size/configuration incomplete |
| 3 | Apple | AirPods Pro | AirPods Pro; generation UNKNOWN | `apple/airpods-pro-unknown-generation/` | UNKNOWN generation; user image integrated, exact variant unverified |
| 4 | Apple | iPad Pro | iPad Pro; generation/size UNKNOWN | `apple/ipad-pro-unknown-variant/` | UNKNOWN variant; API says not recorded |
| 5 | Apple | MacBook Air M3 | MacBook Air M3 | `apple/macbook-air-m3/` | Model stated in API; configuration incomplete |
| 6 | Sony | Tai nghe Sony | UNKNOWN | `sony/headphones-unknown-model/` | UNKNOWN model; API gives only generic headphone name |
| 7 | Apple | Apple Watch | UNKNOWN | `apple/apple-watch-unknown-model/` | UNKNOWN model/generation; user image integrated, exact variant unverified |
| 8 | UNKNOWN | Sạc không dây | UNKNOWN | `unknown/wireless-charger-unknown-brand-model/` | UNKNOWN brand and model in API |
| 9 | Apple | iPhone 16 128GB | iPhone 16 128GB | `apple/iphone-16-128gb/` | Model/storage stated in API; SKU/color incomplete |
| 10 | Apple | Mac mini M4 16GB/256GB | Mac mini M4 16GB/256GB | `apple/mac-mini-m4-16gb-256gb/` | Model/configuration stated in API; SKU incomplete |
| 11 | Samsung | Galaxy S25 Ultra 256GB | Galaxy S25 Ultra 256GB | `samsung/galaxy-s25-ultra-256gb/` | Model/storage stated in API |
| 12 | Samsung | Galaxy S25 256GB | Galaxy S25 256GB | `samsung/galaxy-s25-256gb/` | Model/storage stated in API |
| 13 | Samsung | Galaxy A56 5G 256GB | Galaxy A56 5G 256GB | `samsung/galaxy-a56-5g-256gb/` | Model/storage stated in API |
| 14 | Samsung | Galaxy Z Flip6 256GB | Galaxy Z Flip6 256GB | `samsung/galaxy-z-flip6-256gb/` | Model/storage stated in API |
| 15 | Samsung | Galaxy Tab S10 FE 128GB | Galaxy Tab S10 FE 128GB | `samsung/galaxy-tab-s10-fe-128gb/` | Model/storage stated in API |
| 16 | Samsung | Galaxy Buds3 Pro | Galaxy Buds3 Pro | `samsung/galaxy-buds3-pro/` | Model stated in API |
| 17 | Samsung | Galaxy Watch7 44mm | Galaxy Watch7 44mm | `samsung/galaxy-watch7-44mm/` | Model/size stated in API |
| 18 | ASUS | Zenbook S 14 UX5406 32GB/1TB | Zenbook S 14 UX5406 | `asus/zenbook-s-14-ux5406-32gb-1tb/` | Model/configuration stated in API |
| 19 | ASUS | Vivobook S 14 OLED M5406 16GB/1TB | Vivobook S 14 OLED M5406 | `asus/vivobook-s-14-oled-m5406-16gb-1tb/` | Model/configuration stated in API |
| 20 | ASUS | ROG Zephyrus G14 GA403 | ROG Zephyrus G14 GA403 | `asus/rog-zephyrus-g14-ga403/` | Model stated in API; configuration incomplete |
| 21 | ASUS | TUF Gaming A15 FA507 16GB/512GB | TUF Gaming A15 FA507 | `asus/tuf-gaming-a15-fa507-16gb-512gb/` | Model/configuration stated; full SKU not in API |
| 22 | ASUS | ROG Ally X 2024 | ROG Ally X 2024 | `asus/rog-ally-x-2024/` | Model/year stated in API |
| 23 | ASUS | ProArt Display PA278QV | ProArt Display PA278QV | `asus/proart-display-pa278qv/` | Model stated in API |
| 24 | LG | LG gram 14 2024 16GB/512GB | LG gram 14 2024 | `lg/gram-14-2024-16gb-512gb/` | Model/configuration stated; full SKU not in API |
| 25 | LG | LG UltraGear 27GS75Q-B | LG UltraGear 27GS75Q-B | `lg/ultragear-27gs75q-b/` | Model stated in API |
| 26 | LG | LG OLED evo C4 55 inch | LG OLED evo C4 55 inch | `lg/oled-evo-c4-55-inch/` | Model/size stated; full SKU not in API |
| 27 | LG | LG XBOOM Go XG2 | LG XBOOM Go XG2 | `lg/xboom-go-xg2/` | Model stated in API |
| 28 | LG | LG gram +view 16MR70 | LG gram +view 16MR70 | `lg/gram-view-16mr70/` | Model stated in API; portable monitor |
| 29 | Lenovo | ThinkPad X1 Carbon Gen 12 32GB/1TB | ThinkPad X1 Carbon Gen 12 | `lenovo/thinkpad-x1-carbon-gen-12-32gb-1tb/` | Model/configuration stated; full machine type not in API |
| 30 | Lenovo | Yoga Slim 7x 14Q8X9 16GB/512GB | Yoga Slim 7x 14Q8X9 | `lenovo/yoga-slim-7x-14q8x9-16gb-512gb/` | Model/configuration stated; full machine type not in API |
| 31 | Lenovo | LOQ 15AHP9 16GB/512GB | LOQ 15AHP9 | `lenovo/loq-15ahp9-16gb-512gb/` | Model/configuration stated; full machine type not in API |
| 32 | Lenovo | Legion Go 8APU1 16GB/512GB | Legion Go 8APU1 | `lenovo/legion-go-8apu1-16gb-512gb/` | Model/configuration stated in API |
| 33 | Lenovo | IdeaPad Slim 5 14IMH9 16GB/512GB | IdeaPad Slim 5 14IMH9 | `lenovo/ideapad-slim-5-14imh9-16gb-512gb/` | Model/configuration stated; full machine type not in API |
| 34 | Lenovo | Tab P12 8GB/128GB | Lenovo Tab P12 | `lenovo/tab-p12-8gb-128gb/` | Model/configuration stated in API |

## UNKNOWN entries

- ID 3: AirPods Pro generation is absent from the API; the user-provided reference image does not identify it conclusively.
- ID 4: iPad Pro generation and screen size are absent from the API.
- ID 6: only generic “Tai nghe Sony” is recorded; no model number.
- ID 7: Apple Watch generation/model is absent from the API; the user-provided reference image does not identify it conclusively.
- ID 8: brand and model of the wireless charger are both unidentified.

## User-provided images integrated from source folders

The files below are referenced directly from the storefront manifest; original
source PNGs remain in place. The user confirmed display authorization. Image
identity/variant and specific license or attribution terms have not been
independently verified.

| Product ID | Source image file | Note |
|---:|---|---|
| 2 | `apple/macbook-pro-m4/product-2-user-provided.png` | User supplied |
| 3 | `apple/airpods-pro-unknown-generation/product-3-user-provided.png` | Exact generation UNKNOWN |
| 4 | `apple/ipad-pro-unknown-variant/product-4-user-provided.png` | User supplied; exact iPad generation remains UNKNOWN |
| 6 | `sony/headphones-unknown-model/product-6-user-provided.png` | User supplied; exact Sony headphone model remains UNKNOWN |
| 7 | `apple/apple-watch-unknown-model/product-7-user-provided.png` | Exact model/generation UNKNOWN |
| 8 | `unknown/wireless-charger-unknown-brand-model/product-8-user-provided.png` | Visible Ergoflife logo; catalog brand remains UNKNOWN |
| 9 | `apple/iphone-16-128gb/product-9-user-provided.png` | User supplied |
| 10 | `apple/mac-mini-m4-16gb-256gb/product-10-user-provided.png` | User supplied |
| 11 | `samsung/galaxy-s25-ultra-256gb/product-11-user-provided.png` | User supplied |
| 12 | `samsung/galaxy-s25-256gb/product-12-user-provided.png` | User supplied |
| 13 | `samsung/galaxy-a56-5g-256gb/product-13-user-provided.png` | User supplied |
| 14 | `samsung/galaxy-z-flip6-256gb/product-14-user-provided.png` | User supplied |
| 15 | `samsung/galaxy-tab-s10-fe-128gb/product-15-user-provided.png` | User supplied |
| 16 | `samsung/galaxy-buds3-pro/product-16-user-provided.png` | User supplied |
| 17 | `samsung/galaxy-watch7-44mm/product-17-user-provided.png` | User supplied |
| 18 | `asus/zenbook-s-14-ux5406-32gb-1tb/product-18-user-provided.png` | User supplied |
| 20 | `asus/rog-zephyrus-g14-ga403/product-20-user-provided.png` | ROG image; LapVip watermark visible |
| 21 | `asus/tuf-gaming-a15-fa507-16gb-512gb/product-21-user-provided.png` | User supplied |
| 22 | `asus/rog-ally-x-2024/product-22-user-provided.png` | User supplied |
| 23 | `asus/proart-display-pa278qv/product-23-user-provided.png` | Phuong Tin watermark visible |
| 24 | `lg/gram-14-2024-16gb-512gb/product-24-user-provided.png` | User supplied |
| 25 | `lg/ultragear-27gs75q-b/product-25-user-provided.png` | User supplied |
| 26 | `lg/oled-evo-c4-55-inch/product-26-user-provided.png` | User supplied |
| 27 | `lg/xboom-go-xg2/product-27-user-provided.png` | Webuy watermark visible |
| 28 | `lg/gram-view-16mr70/product-28-user-provided.png` | User supplied |
| 29 | `lenovo/thinkpad-x1-carbon-gen-12-32gb-1tb/product-29-user-provided.png` | User supplied |
| 30 | `lenovo/yoga-slim-7x-14q8x9-16gb-512gb/product-30-user-provided.png` | User supplied |
| 31 | `lenovo/loq-15ahp9-16gb-512gb/product-31-user-provided.png` | User supplied |
| 32 | `lenovo/legion-go-8apu1-16gb-512gb/product-32-user-provided.png` | User supplied |
| 33 | `lenovo/ideapad-slim-5-14imh9-16gb-512gb/product-33-user-provided.png` | User supplied |
| 34 | `lenovo/tab-p12-8gb-128gb/product-34-user-provided.png` | User supplied |

Reference PNGs previously received for IDs 3 and 7 remain in their folders.
No Vivobook image was attached for ID 19, so it remains without a reference image.
The images for IDs 3, 4, 6, 7, and 8 do not resolve all missing model/brand
details. The catalog data remains unchanged; IDs 3, 4, 6, 7, and 8 remain
marked UNKNOWN where the model or brand is not known.

No product or database data was changed. Source images are integrated for IDs
2-4, 6-18, and 20-34. Existing licensed images for IDs 1 and 5 remain active;
ID 19 has no Vivobook image and retains its placeholder.

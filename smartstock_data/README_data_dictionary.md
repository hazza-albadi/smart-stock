# SmartStock – Sample Dataset (synthetic)

Demo company: **Qeshour**, an Omani company that extracts chitosan from marine shell waste (shrimp, crab, lobster shells).
The data describes its planned production and storage facility (WH-01). All numbers are **synthetic**, created for the OQBi Hackathon demo.
"Today" in the data = **2026-10-05**. History = 52 weeks (2025-10-06 -> 2026-10-03). Currency = OMR. Area = m².

| File | What it contains |
|---|---|
| items.csv | 24 items: shells (raw material), process chemicals, lab consumables, safety gear, packaging, spares, bulk supplies. Columns include storage type, zone, unit cost, supplier, lead time (days), safety stock, shelf life, space per unit (m²), criticality (A = essential, B = important, C = can wait) |
| suppliers.csv | 6 suppliers |
| stock_movements.csv | ~1,500 IN/OUT movements (history for forecasting) |
| current_stock.csv | Current lots per item: quantity, received date, expiry date |
| purchase_orders_open.csv | Orders already placed and not yet received (one is DELAYED_BY_SUPPLIER) |
| purchasing_budget.csv | Purchasing budget for the next 4 weeks (18,000 OMR). Open purchase orders (about 14,010 OMR) already count against it, so only about 3,990 OMR is left for new orders |
| warehouse_zones.csv | 5 zones: capacity, fixed occupied area, reserved buffer, rent_allowed |
| space_requests.csv | 5 requests from other companies looking for storage space |

Quantities: shells are in kg; chemicals in carboys/bags/bottles; see the `unit` column.

## Warehouse numbers (match the idea document)
- Total capacity 10,000 m² / used 6,500 m² / unused 3,500 m².
- Used area of a zone = fixed_occupied_m2_aisles_equipment + sum(quantity_on_hand x space_m2_per_unit of items in that zone).
- Rentable area of a zone = capacity - used - reserved_buffer_m2, only if rent_allowed = yes.
  Rentable: Z1 = 500 m², Z5 = 900 m² (total 1,400 m², not 3,500). Raw-material (Z2), cold (Z3) and hazardous-chemical (Z4) zones are never rentable, and buffers are kept for the company's own growth.

## Zones
Z1 General Storage (packaging, lab, safety gear) | Z2 Raw Materials - Dry (dried shells, glycerol, distilled water) | Z3 Cold Storage (fresh/frozen shells) | Z4 Hazardous Materials (acids, alkalis, bleach) | Z5 Overflow / Bulk

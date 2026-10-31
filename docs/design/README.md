# Octopus B2B — UX/UI design screens

33 screens designed at 1440 px desktop width. Every screen also works on mobile: portal sidebars turn into a horizontal tab bar under 760 px, and sticky side panels become static.

- `<Name>.png` — full-page picture of the screen. Use it to see the layout.
- `html/<Name>.html` — the same screen as static HTML with all CSS inline. Open it in a browser, or tell Antigravity to read it for exact spacing, colours, font sizes and copy. Links between screens work.
- `assets/logo.png` (for light backgrounds) and `assets/logo-white.png` (for the navy background).
- `diagrams/` — system architecture and order lifecycle (also in SPEC.md).

Design tokens: navy #11133C, blue #2A6FD6, page #F5F6F8, border #E2E5EA; fonts Lexend (headings), Inter (body), IBM Plex Mono (codes, prices, API keys). See SPEC.md section 8.

How to use with Antigravity: in each phase prompt, say for example "Build /p/[slug] to match docs/design/Product.png; take exact styles and copy from docs/design/html/Product.html; convert to React components with Tailwind and shadcn/ui; replace hard-coded text, prices and contacts with data from Supabase as described in SPEC.md".

## Storefront

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Main** | Storefront · Home | `/` | Public | [Main.png](Main.png) · [html/Main.html](html/Main.html) |
| **Products** | Storefront · All products | `/products, /c/[...slug], /search` | Public | [Products.png](Products.png) · [html/Products.html](html/Products.html) |
| **Product** | Storefront · Product detail | `/p/[slug]` | Public | [Product.png](Product.png) · [html/Product.html](html/Product.html) |
| **Request** | Request Center · Sourcing, 3PL, Dropshipping, Samples, QC, Certification | `/request/[type]` | Public → login | [Request.png](Request.png) · [html/Request.html](html/Request.html) |
| **Auth** | Sign up & log in · Google + email | `/login, /signup, /onboarding` | Public | [Auth.png](Auth.png) · [html/Auth.html](html/Auth.html) |

## Customer portal

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Customer** | Customer portal · Dashboard | `/account` | Customer | [Customer.png](Customer.png) · [html/Customer.html](html/Customer.html) |
| **CustomerOrders** | Customer portal · Orders & live tracking | `/account/orders, /account/orders/[id], /account/rfqs/[id]` | Customer | [CustomerOrders.png](CustomerOrders.png) · [html/CustomerOrders.html](html/CustomerOrders.html) |
| **CustomerKYC** | Customer portal · Company & KYC | `/account/kyc` | Customer | [CustomerKYC.png](CustomerKYC.png) · [html/CustomerKYC.html](html/CustomerKYC.html) |
| **Wallet** | Customer portal · Wallet | `/account/wallet` | Customer | [Wallet.png](Wallet.png) · [html/Wallet.html](html/Wallet.html) |
| **Ledger** | Customer portal · Ledger & invoices | `/account/ledger` | Customer | [Ledger.png](Ledger.png) · [html/Ledger.html](html/Ledger.html) |
| **Developer** | Customer portal · API credentials | `/account/developer` | Customer | [Developer.png](Developer.png) · [html/Developer.html](html/Developer.html) |
| **Support** | Customer portal · Help & complaints, feedback | `/account/support` | Customer | [Support.png](Support.png) · [html/Support.html](html/Support.html) |

## Distributor

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Distributor** | Distributor panel · Suppliers & on/off controls | `/distributor` | Distributor | [Distributor.png](Distributor.png) · [html/Distributor.html](html/Distributor.html) |
| **ProductCreate** | Distributor panel · Create product (AI photos, poster, SEO) | `/distributor/products/new, /products/[id]/edit` | Distributor, supplier, admin | [ProductCreate.png](ProductCreate.png) · [html/ProductCreate.html](html/ProductCreate.html) |
| **BulkUpload** | Distributor panel · Bulk upload (Excel) | `/distributor/products/import` | Distributor, supplier, admin | [BulkUpload.png](BulkUpload.png) · [html/BulkUpload.html](html/BulkUpload.html) |
| **Catalog** | Admin & Distributor · Categories (4 levels) & tags | `/distributor/catalog, /admin/catalog` | Distributor, admin | [Catalog.png](Catalog.png) · [html/Catalog.html](html/Catalog.html) |

## Supplier portal (later)

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Supplier** | Supplier portal · RFQ inbox | `/supplier, /supplier/rfqs` | Supplier (portal off at launch) | [Supplier.png](Supplier.png) · [html/Supplier.html](html/Supplier.html) |
| **SupplierCustomers** | Supplier portal · Customers | `/supplier/customers` | Supplier | [SupplierCustomers.png](SupplierCustomers.png) · [html/SupplierCustomers.html](html/SupplierCustomers.html) |
| **SupplierAPI** | Supplier portal · Product import (1688 / Alibaba) & API | `/supplier/integrations` | Supplier | [SupplierAPI.png](SupplierAPI.png) · [html/SupplierAPI.html](html/SupplierAPI.html) |
| **AdsCampaign** | Advertiser · Create campaign | `/account/ads, /supplier/ads` | Advertiser | [AdsCampaign.png](AdsCampaign.png) · [html/AdsCampaign.html](html/AdsCampaign.html) |

## Back office

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Office** | Back office · Verification & queues | `/office` | Back office | [Office.png](Office.png) · [html/Office.html](html/Office.html) |
| **Shipping** | Back office · YunExpress shipment | `/office/shipping` | Operations | [Shipping.png](Shipping.png) · [html/Shipping.html](html/Shipping.html) |
| **SupportDesk** | Back office · Support desk (customer service) | `/office/support` | Support | [SupportDesk.png](SupportDesk.png) · [html/SupportDesk.html](html/SupportDesk.html) |

## Admin

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Admin** | Admin · Reports & control | `/admin` | Admin | [Admin.png](Admin.png) · [html/Admin.html](html/Admin.html) |
| **Finance** | Admin · Finance & revenue | `/admin/finance` | Finance, admin | [Finance.png](Finance.png) · [html/Finance.html](html/Finance.html) |
| **AdsAdmin** | Admin · Advertising (pay per click) | `/admin/ads` | Admin | [AdsAdmin.png](AdsAdmin.png) · [html/AdsAdmin.html](html/AdsAdmin.html) |
| **Staff** | Admin · Staff & roles | `/admin/staff` | Admin | [Staff.png](Staff.png) · [html/Staff.html](html/Staff.html) |
| **Geo** | Admin · Customer geography | `/admin/geography` | Admin | [Geo.png](Geo.png) · [html/Geo.html](html/Geo.html) |
| **Fees** | Admin · Services & charges | `/admin/services` | Admin | [Fees.png](Fees.png) · [html/Fees.html](html/Fees.html) |
| **WalletAdmin** | Admin · Wallets & payments (on/off switch) | `/admin/wallet` | Admin | [WalletAdmin.png](WalletAdmin.png) · [html/WalletAdmin.html](html/WalletAdmin.html) |
| **Integrations** | Admin · Integrations | `/admin/integrations` | Admin | [Integrations.png](Integrations.png) · [html/Integrations.html](html/Integrations.html) |
| **CMS** | Admin · Site content, Terms editor, company & branches | `/admin/content` | Content editor, admin | [CMS.png](CMS.png) · [html/CMS.html](html/CMS.html) |
| **Catalog** | Admin & Distributor · Categories (4 levels) & tags | `/distributor/catalog, /admin/catalog` | Distributor, admin | [Catalog.png](Catalog.png) · [html/Catalog.html](html/Catalog.html) |

## Documents

| Screen | What it shows | Route | Who uses it | Files |
| --- | --- | --- | --- | --- |
| **Invoice** | Proforma invoice (A4, generated after quote approval) | `PDF template (render-pdf)` | All roles (documents) | [Invoice.png](Invoice.png) · [html/Invoice.html](html/Invoice.html) |

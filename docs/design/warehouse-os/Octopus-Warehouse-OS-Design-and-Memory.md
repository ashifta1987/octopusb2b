---
title: "Octopus Warehouse OS: updated UI/UX design and project memory"
date: "25 November 2026"
---

Octopus Warehouse OS is the 3PL and logistics module for your Foshan warehouse. It has 31 clickable boards: 14 staff screens, 8 client portal screens, 2 public pages, 3 handheld or customer screens, and 4 admin screens added this round.

# 1. What it is

| Item | Detail |
| --- | --- |
| Warehouse | Foshan, Guangdong, China |
| Contact | foshan@octopusb2b.com |
| Work hours | 8 am to 6 pm China time |
| Minimums | None. No minimum order and no minimum stock size |
| Carriers | YunExpress and 4PX, chosen by rules with a fallback |
| Brand | Navy #1A174A, blue #2563C9, light blue #8FB6F8, tints #EEF3FD and #B7CCF3. Octopus B2B logo in every header |
| Build | Design artboards with sample data. Left-menu links and the buttons work when you press Play on a board |

Three audiences use it: warehouse staff (packers, receivers, supervisors, admin), your clients through the portal, and the public before they sign in.

# 2. How the Octopus family connects

The warehouse sits in the middle: goods arrive from sourcing or from a client's own brand, and orders arrive from dropship or the client's store.

| System | Role | What reaches the warehouse | What goes back |
| --- | --- | --- | --- |
| Octopus B2B | Sourcing | Stock notices and quality reports from factories | Receiving and inspection results |
| Make My Brand | Own brand | Products made with the client's name, logo and packaging | Stock received, counts |
| Octopus Dropship | Selling | Orders from the client's stores | Tracking numbers |
| Octopus 3PL (this module) | Warehouse | Receives, stores, packs with proof, ships | Photos, weight, scan log, tracking, invoice |
| YunExpress and 4PX | Carriers | Parcels handed over | Tracking events |

Private dropship has two routes. With your brand, the product comes through Make My Brand and ships in your branded box and packing slip. Without your brand, the product is chosen from what Octopus B2B sources and ships in a neutral box with your store name on the slip. Both routes share one portal, packing proof, tracking to the store, returns decisions and one invoice.

# 3. The workflow, from apply to invoice

One parcel passes eleven steps, and each one leaves a record the client can see.

1. **Apply and approve.** The client applies on the public page. Staff review company documents and dangerous goods, pick a rate plan and approve. Approval creates the portal account and the carrier rules to confirm.
2. **Send stock.** The client creates a stock notice (ASN) in the portal. The gate cannot check in a delivery that has no ASN.
3. **Book the dock.** Each delivery has a booked slot: Booked, Arrived, Unloading, Done.
4. **Receive.** A handheld scan counts every carton against the ASN. Short, over and damaged items are recorded with photos.
5. **Count and label.** Counts run twice when they differ. A lot with a difference stays blocked until a supervisor approves. Lots and serials are recorded.
6. **Put away.** Pallets and cartons go to a rack, row and bin. Each bin has its own location label.
7. **Receive orders.** Orders arrive from Octopus Dropship, a store connection, a CSV upload or the API.
8. **Pick.** A handheld picks to the order by scanning.
9. **Pack with proof.** The packer scans every item, the system picks the box and packaging materials, adds the battery mark when needed, and the parcel is weighed. A large weight difference stops the parcel until a supervisor enters a PIN.
10. **Label and hand over.** Rules choose YunExpress or 4PX by country, product type and weight, with a fallback. The label is scanned to confirm it belongs to the order. Multi-parcel orders and freight pallets are built here.
11. **Track, return, invoice.** Tracking goes back to the store. Returns are inspected and photographed, and the client chooses restock, discard or send back. One monthly invoice lists every charge.

# 4. Staff screens

Every desktop staff screen shares one left menu: Dashboard, Orders, Packing station, Dispatch and freight, Multi-parcel packing, Putaway and pallets, Counts and lots, Materials, Label centre, Inbound, Dock appointments, Evidence, Scale check, Carriers and rules, Clients, Rates, Exceptions, Reports, Users and roles, and a link to the client portal.

| Board | Screen | What it does |
| --- | --- | --- |
| 1 | Admin dashboard | The day at a glance, plus a panel showing the connections to Octopus B2B, Make My Brand, Octopus Dropship, YunExpress and 4PX |
| 2 | Packing station | Scan items, choose box and materials, weigh. Dangerous goods add the battery mark and block closing without it. A weight difference needs a supervisor PIN with a reason; three wrong PINs lock the override |
| 3 | Order detail | One order: box, expected and measured weight, volumetric weight, history |
| 4 | Packing evidence | Contents, seal and scale photos, scan log, weights and the retention period for one order |
| 5 | Handheld receiving | Count each carton against the ASN and record differences |
| 6 | Handheld picking | Pick to the order by scanning |
| 7 | Customer tracking page | What the end customer sees: order tracking, packed and shipped from Foshan |
| 9 | Carriers and rules | Rules that pick the YunExpress or 4PX service by country, product type and weight, with a fallback |
| 10 | Putaway and pallets | Pallets by source and owner, put away to rack, row and bin |
| 11 | Label centre | Print and reprint carton, pallet and parcel labels |
| 12 | Packaging materials | Boxes, mailers, tape and marks as stock, charged by use |
| 13 | Freight pallet build | Build outbound pallets for freight |
| 14 | Multi-parcel packing | Orders that ship in more than one parcel |
| 15 | Dock appointments | Slots, owner, load and ASN. Check in, unload, finish. A slot with no ASN cannot be checked in. A booking form blocks double booking |
| 16 | Counts, lots and serials | Two-pass counts, supervisor approval, blocked lots that cannot be picked, serial scanning with duplicate detection |
| 17 | Scale check | Per-bench calibration reads. A failed bench is locked until it passes |
| 26 | Clients and applications | Review new applications, tick the checks, choose a plan, approve or decline. Approve stays disabled until every check is done |
| 28 | Rates and quotes | Editable rate card with Standard, Volume and Custom plans, and a monthly quote calculator |
| 29 | Exceptions | A queue of weight, receiving, label, stock and carrier problems. Assign an owner and a resolution, then release the order |
| 30 | Reports | Orders shipped, dock-to-shelf time, order-to-handoff time and exceptions, by period and client, with service-quality bars |
| 31 | Users and roles | Staff list, suspend and restore, add a person with a role, and a table of what each role can do |

# 5. Client portal

The portal has eight tabs: Overview, Inventory, Orders, Send stock, Returns, Invoices, Integrations and Support. The header and tab bar line up with the page content on every tab.

| Board | Tab | What the client does |
| --- | --- | --- |
| 8 | Overview | Units in stock, open orders, shipped this week, stock on its way in, and shortcuts to send stock and upload orders |
| 18 | Inventory | Stock by product with a thumbnail, available, reserved, incoming and days of cover. A larger photo shows for the selected product |
| 19 | Orders and proof | Order list with status and a step tracker. Opens the packing proof: contents, sealed box and scale photos, weight check, scan log, link to tracking |
| 20 | Send stock | Create a stock notice with cartons and units, pick an arrival date, send. Shows notices on their way and received |
| 21 | Returns | Return list and a decision for each: restock, discard or send back |
| 22 | Invoices | Monthly statement. Every line opens to the orders and movements behind it |
| 23 | Integrations | Shopify, WooCommerce, Wix, TikTok Shop, eBay, CSV upload, API and webhooks, Octopus Dropship, Octopus B2B and Make My Brand |
| 24 | Support | New request by type and order, request list with status, and a thread with the packing record or a damaged-carton photo attached |

The portal's sample client orders are CL6-10478 to CL6-10482. CL6-10481 is a laptop stand and USB-C hub, 2 items, shipped by 4PX, with matching proof photos.

# 6. Public pages

**Intro page (board 25).** A single long page before sign in. The header has the logo, seven short links (Who it is for, Octopus family, How it works, Services, Proof, Connections, FAQ), Sign in and Apply for an account. Sections in order:

1. Hero with a sample packing record for demo order DEMO-1042: contents, sealed and weighed photos, expected 266 g, measured 270 g.
2. Who it is for: four kinds of seller, with a photo for each.
3. Octopus family: Octopus B2B, Make My Brand, Octopus 3PL and Octopus Dropship, each with its logo, and a route picker for private dropship with or without your brand.
4. How it works: six steps with what we do and what you see.
5. Services: receiving, storage, pick and pack, packaging materials, shipping with YunExpress and 4PX, and returns.
6. Packing proof: three photos, scan log, weight check and label match.
7. Connections: sales channels in, tracking out, carrier logos.
8. Billing, then three steps to your first order, then FAQ (where the warehouse is, no minimums, countries, retention).
9. Image credits and the Foshan footer with email and hours.

**Apply and sign in (board 27).** One card with two tabs. Apply asks for company, name and a valid work email, what you sell, orders a month, sales channels and how stock reaches us. Choosing batteries or liquids shows a safety-data-sheet note. Send stays disabled until the required fields are filled, then shows reference APP-0107 and the reply promise of one working day. Sign in links to the client portal and, below it, to staff sign in.

# 7. Rules, controls and data mapping

**Controls built into the screens**

- No ASN, no check-in at the dock. A double-booked slot is refused.
- A parcel cannot close without a weight inside tolerance, or a supervisor PIN override with a reason. Sample PIN is 1234. Three wrong PINs lock the override.
- Dangerous goods are detected from the order and add the battery mark and carrier rules.
- A count that differs is recounted, and a lot with a difference is blocked until a supervisor approves.
- A failed scale bench is locked until it passes the check.
- Approving a client needs documents, a dangerous goods check, terms sent and a rate plan.
- A person cannot be added twice. Packers cannot approve overrides or counts, and only admins change rates, carrier rules or users.
- Packing evidence is kept for a set retention period, shown on the Evidence screen and in the FAQ.

**How the numbers line up across screens**

| Item | Where it appears | Value |
| --- | --- | --- |
| ASN-0091 | Portal Send stock, portal Overview, Dock | 2 pallets, Client 06, arrives today 14:00, Booked |
| ASN-0089 | Dock | Client 12, 40 cartons, Unloading |
| ASN-0093 and ASN-0094 | Dock, Putaway, Labels | Octopus B2B stock (container, 10 pallets) |
| ASN-0096 | Receiving | Handheld receiving sample |
| ASN-0098 | Putaway | Client stock |
| Client order CL6-10481 | Portal Orders, Inventory, Integrations, Support | Laptop stand and USB-C hub, 2 items, 4PX |
| Demo order DEMO-1042 | Intro page, Evidence | 266 g expected, 270 g measured |
| Dropship order | Packing station, Order detail | Earbuds and case (EB-2201, CS-5100) |

The staff Packing station and Evidence screens use the Octopus Dropship earbuds order. The portal uses a client who ships laptop stands, lamps and organisers. They are two different clients, not one story.

# 8. Images and content

The design uses 31 supplied images, uploaded to the artifact. After the alignment pass, 25 are in use.

| Group | Where used | Notes |
| --- | --- | --- |
| Packing proof (3: contents, seal, scale) | Intro page hero and Proof section, Evidence, portal Orders | Illustrative sample for DEMO-1042, labelled as a sample |
| Warehouse scenes (3) | Intro page Services gallery | AI-generated illustrations |
| Audience and step photos | Intro page Who it is for and How it works | AI-generated illustrations |
| Product thumbnails (6) | Portal Inventory, Counts | Laptop stand, desk lamp, cable organiser, webcam cover, phone stand, USB-C hub. AI-adapted from Wikimedia Commons photos, credited on the intro page |
| Brand logos (4) | Headers, family cards | Octopus B2B, Octopus 3PL, Make My Brand, Octopus Dropship. Cropped to 22 KB, 14 KB and 28 KB |
| Carrier logos (2) | Intro page Connections | YunExpress and 4PX |
| Damaged carton (1) | Portal Support | Attached to a warehouse reply |

Removed as unnecessary: the large hero band photo, the team photo section, and the returns desk photo card. Unused files you can delete: the original hero (01), team (29), returns desk (30) and the three uncropped logo files.

All images have alt text. Copy is plain and short, with no square-bracket placeholders left.

# 9. Changes in this round, and open items

**Changed**

- Photo pass: unnecessary photos removed, logos cropped and compressed, portal header and tabs aligned with the page, intro page header made shorter so it no longer wraps.
- Second audit: ASN numbers now match across Dock, portal and staff screens; the intro page sample is labelled as demo order DEMO-1042.
- New screens: Apply and sign in, Clients, Rates and quotes, Exceptions, Reports, Users and roles. Added to the left menu and the canvas.
- Foshan address, email and hours added. Footer, FAQ, Apply confirmation and Support note updated.
- No minimum order or stock size stated in the FAQ. The merchant store name placeholder was removed from the tracking page.
- Automated checks: 56 functional checks and a link, handler and hole audit all pass. The new screens were not viewed rendered in a browser.

**Open items**

- YunExpress and 4PX logos have no confirmed permission for public display.
- Rates, report figures and staff names are placeholders until you set real ones.
- The intro page does not show which days the warehouse is open, only the hours.
- Decide whether the staff and portal samples should become one client story.
- The PackingStation and Picking screens have no product photos for the earbuds, case and cable.
- Not designed yet: a staff notification centre, client user management in the portal, and a real address and dock booking page for clients.

# 10. Project memory as stored

This is the saved memory for the China warehouse project, last updated 25 Nov 2026.

- Has a dropshipping warehouse in China that will connect to Octopus B2B and the Octopus Dropship application, and will also provide 3PL services.
- Planning a web application for the warehouse.
- Will connect YunExpress and 4PX ("40px") for the own-fulfilled warehouse application.
- The Octopus B2B logo (shared as an image) is meant for the 3PL and logistics warehouse module's UI. The turnkey sourcing app's UI is already made separately.
- The 3PL and logistics module should also connect with Octopus B2B sourcing, Make My Brand and Octopus Dropship, including private dropship (products from Make My Brand) with or without your brand.
- The warehouse is in Foshan, China. Contact email foshan@octopusb2b.com. Work hours 8 am to 6 pm.
- The 3PL has no minimum order and no minimum stock size.

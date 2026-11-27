# Prompt — Octopus Back Office in ERP style (staff apps) · ODS 1.0 compact

You are updating the **staff back office** of Octopus B2B (Next.js 16 + Supabase + Vercel). Customers never see these screens.

The design files are in the package under `backoffice/`. Match them:
- `ERP_Dashboard.html`
- `ERP_Invoices.html`
- `ERP_Customer.html`
- `ERP_Components.html`
- `ERP_States.html`
- `M_ERP_Approvals.html`

Read `README.md` (the Back Office section) and `UI-RULES.md` first.

## 0. Rules that don't change

- **Keep all business logic, database tables, RLS, permissions, APIs and workflows.** This is a new look and navigation, not a rewrite. Move one area at a time, behind the existing tests.
- **Keep the current stack.** Do not switch to a different UI framework. Add only:
  - **TanStack Table**, plus TanStack Virtual, for data grids;
  - **cmdk**, for the command palette.
  
  AG Grid is not needed now.
- Release method as always:
  - staging first, with test accounts only;
  - the full Playwright suite and the DB suites pass before any live step;
  - no sign-ins on live;
  - nothing goes to live without the owner's "go".
- Never show example data as live. Money is always shown with its currency.

## 1. ODS tokens and two densities (do this first)

Create `packages/ui` (name `@octopus/ui`) inside this repository. Do not create a separate repository yet.

**Colours, taken from the logo:**

| Token | Value |
|---|---|
| navy | #1A174A |
| navy-dark | #14123B (Back Office top bar) |
| blue | #2A6FD1 |
| teal | #5FD3C9 |
| canvas | #F4F6F9 |
| line | #E3E7EF |
| slate | #5B6478 |
| success | #0B7A75 |
| warning | #B54708 |
| danger | #B42318 |
| focus ring | #F59E0B, 3 px |

**Two densities, set by a `data-density` attribute on `<html>`:**
- `comfortable`: customer apps, as they are now (44 px controls).
- `compact`, for all staff apps:
  - Inter; 13 px body and table text, 12 px labels, 20 px page title;
  - 32 px buttons and inputs, 36 px table rows, 34 px table header;
  - 6 px radius, minimal shadows, no gradients except the top bar.

Use the logo files from `assets/`: the white mark in the Back Office top bar.

## 2. OctopusShell (the frame for every staff page)

- **Top bar**, 48 px, navy-dark. Left to right:
  - logo (links to `/office`);
  - app switcher: Back Office, Accounts, Warehouse OS, Website admin, showing only the apps the user may open;
  - command search button with Ctrl K;
  - **New ▾**;
  - notifications with a count;
  - help;
  - the user's name and role.
- **Sidebar** (`OctopusSidebar`): 232 px, collapsing to 56 px with Ctrl B; the user's choice is saved.
  - Groups: Sales, Services, Accounts, Catalogue, Website and Admin. Each group can collapse.
  - Red counts show items waiting.
  - The current page has a 3 px teal bar.
  - Items the user's role can't open are hidden.
- **Workspace tabs** (`OctopusWorkspace`), browser-style:
  - Every open page or record is a tab with an icon, a title and ✕. Dashboard is pinned (icon only).
  - The active tab is white with a 2 px blue top bar.
  - Unsaved changes show an amber dot instead of ✕. Closing such a tab asks Save / Discard / Cancel. The same check runs on route change and on browser unload.
  - Ctrl+click or middle-click on any record link opens it in a new tab.
  - Ctrl Tab moves to the next tab; Alt W closes the current tab.
  - "N more ⌄" lists the tabs that don't fit. At most 12 tabs; opening a 13th asks to close the oldest unpinned tab.
  - Each tab is a real route. The open tabs, their order, pins, filters and scroll position are saved per user (localStorage plus a `workspace_tabs` row) and restored after a reload.
- **Command palette** (`OctopusSearch`), opened with Ctrl K:
  - It searches customers, RFQs, quotes, orders, invoices, payments, products, suppliers and pages.
  - It lists actions such as "Record payment for …" and "New quote for …".
  - Enter opens a result; Ctrl Enter opens it in a new tab.
  - Results respect permissions.

## 3. Shared components

- **OctopusDataGrid** (TanStack Table):
  - 36 px rows; sticky header; the first data column frozen.
  - Numbers right-aligned with tabular figures.
  - Sort, resize, reorder, show and hide columns; density toggle.
  - **Saved views** per user, plus shared views.
  - Filter chips and "+ Add filter", building an advanced filter panel.
  - Row checkboxes open a **bulk bar** showing the selection total.
  - Right-click or ⋯ opens a context menu. Double-click or Enter opens the record in a tab.
  - Server-side sort, filter and pagination; virtualisation above 200 rows.
  - Export CSV/XLSX that respects filters and permissions.
- **OctopusDrawer**: 460 px from the right, for quick create and edit. Ctrl S saves; Esc closes, with the unsaved-changes check. Records with more than about 12 fields use a full-page form instead.
- Also build:
  - **OctopusTabs** (underline);
  - **OctopusStepper**;
  - **OctopusModal**: only to confirm something that can't be undone; the destructive button is red and named after the action;
  - **OctopusToast**: navy, with Undo where possible;
  - **StatusPill**: dot plus text; one status list shared by every app;
  - **KpiStrip**: one bordered row of 4–5 figures.
- **Keyboard shortcuts:**

  | Keys | Action |
  |---|---|
  | Ctrl K | Command palette |
  | Ctrl B | Collapse or expand the sidebar |
  | Ctrl S | Save |
  | Esc | Close drawer or dialog |
  | Alt W | Close the current tab |
  | Ctrl Tab | Next tab |
  | N | New record |
  | / | Focus the grid search |
  | J / K | Next / previous row |
  | Enter | Open the selected row |

  Show these in Help › Keyboard shortcuts.

## 4. Screens, in this order

1. **Dashboard** `/office`:
   - KPI strip: cash in bank, receivables, payables, customer wallets, waiting for approval;
   - **My work** (tasks assigned to me, each with Open);
   - money in and out over 8 weeks;
   - receivables ageing;
   - MOQ pools closing soon;
   - recent activity.
   
   The widgets shown depend on the role.
2. **Accounts › Invoices** `/office/accounts/invoices`:
   - KPI strip;
   - status tabs (All, Draft, Sent, Partly paid, Overdue, Paid, Credit notes);
   - filter chips and saved views;
   - the grid; the bulk bar (Send reminder, Record payment, Export, Mark as…);
   - the **Record payment** drawer: amount, date, method, bank account, and a bank reference that must match the bank feed.
3. **Customer record** `/office/customers/[id]`:
   - header with status and the main actions;
   - underline tabs: Overview, Orders, Invoices, Wallet, RFQs, Documents, Team, Activity, Notes;
   - the Overview shows company, money, open items, recent orders, and activity with notes.
   - The credit line is visible to Finance only. Pay later stays internal.
4. Move the existing staff pages into the shell, one module at a time, without changing their logic: Sourcing requests, Quotes, Orders, MOQ pools, Turnkey, Make My Brand, Dropshipping, Warehouse (3PL), Shipping, Payments, Wallets, Credit notes, Ledger, Bank reconciliation, Reports, Products, Suppliers, Website, Users and roles, Settings and Audit log.
5. **Phone**: `/office` on a phone shows **Approvals**, search and read-only records. Editing shows "Open this on a computer".

## 5. Money and safety rules

- **Two-person approval:** money actions above the limit in settings (US$ 2,500 in the designs) go to Approvals. The person who recorded an action cannot approve it. This needs a second Finance user before go-live; tell the owner.
- Every money action writes to the audit log: who, when, old value and new value.
- Bank details come from Admin › Payment settings. Never put them in code.
- Staff screens may show supplier names, cost and margin **only** for roles allowed to see them. These never reach customer screens or exports.

## 6. Tests (Playwright plus DB)

- The shell renders for each role. Hidden modules are missing from both the sidebar and the command palette.
- Workspace tabs:
  - open, close, pin and reorder;
  - restored after a reload;
  - the 13th tab asks to close the oldest;
  - the unsaved-changes guard works on tab close, route change and browser unload.
- Ctrl K finds a customer, an RFQ and an invoice; Ctrl Enter opens a result in a new tab.
- Data grid:
  - sort, filter and saved views persist;
  - the bulk selection total is correct;
  - an export only contains allowed columns.
- Record payment:
  - under the limit, the payment is posted;
  - over the limit, an approval is created;
  - the same user can't approve their own entry;
  - the ledger entries balance (rolled-back test).
- Keyboard: all shortcuts work and focus is visible. No horizontal scroll at 1280 px except inside grids.
- Phone at 390 px: approvals work and editing is blocked with the message.

Report after each step:
- what changed;
- the test results;
- screenshots against the design files;
- anything you couldn't match, and why.

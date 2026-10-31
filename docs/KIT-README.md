# Octopus B2B — build kit for Antigravity

Shenzhen Octopus Trading Co. Ltd. · Global B2B industrial-supplies marketplace
Stack: React (Next.js App Router) · Supabase · Vercel · built with Google Antigravity

## What is in this folder

| Path | What it is |
| --- | --- |
| `docs/SPEC.md` | Master build spec: the single source of truth Antigravity reads. Covers roles, user flows, state machines, data model, integrations, UI, front/back-end wiring, orchestration, testing, security, and build phases P0–P10 with ready-to-paste prompts. |
| `docs/Octopus-B2B-Master-Build-Spec.docx` | The same spec as a Word file, for people to read, print or share. Antigravity uses the `.md` file. |
| `docs/ADDON-15-currency-postman.md` | Add-on prompts 15-A (admin switches the platform currency USD ↔ CNY) and 15-B (Postman as the API partner). The same text is in SPEC.md section 15. |
| `docs/ADDON-16-backup-restore.md` | Add-on prompt 16-A: nightly encrypted off-site backups, Back up now, download, full or partial restore (reinstall all data), data exports. Same text as SPEC.md section 16. |
| `docs/ADDON-17-staff-login.md` | Add-on prompt 17-A: separate staff login for the back office (invitation only, Google or password, required 2FA code, choose workspace by role). Same text as SPEC.md section 17. |
| `docs/design/README.md` | Index of all 35 screens: what each shows, its route and who uses it. |
| `docs/design/*.png` | Full-page picture of each screen (1440 px wide). |
| `docs/design/html/*.html` | The same screens as static HTML with exact CSS. Open any one in a browser; links between screens work. |
| `docs/design/assets/` | Logo for light and dark backgrounds. |
| `docs/design/diagrams/` | System architecture and order lifecycle diagrams. |

## How to start

1. Create an empty Git repository and copy the `docs/` folder into it.
2. Open the repository folder in Antigravity and switch to **Planning mode**.
3. Paste this first message:

```
You are building Octopus B2B. docs/SPEC.md is the single source of truth; read it fully before planning.
The UI must match the screens in docs/design/ (PNG for layout, docs/design/html/ for exact styles and copy;
index in docs/design/README.md). Do not hard-code prices, fees, contacts or legal text: they come from Supabase.
We build in phases. Start with Phase P0 from SPEC.md section 13 only. Propose a plan, wait for my approval,
then build. When done, show me how each "Done when" check for P0 passes.
```

4. After P0 passes, paste the P1 prompt from SPEC.md section 13, and so on through P10. Commit after each phase and check the Vercel preview.
5. To change a feature later, edit `docs/SPEC.md` first, then tell Antigravity: "SPEC.md section X changed; update the code to match."

## Before you reach these phases

- Add-on prompts in SPEC.md section 15: add "Also apply docs/SPEC.md section 15.1" to the P4 and P5 prompts, then run prompt 15-A after P5. Run prompt 15-B with or right after P9. Run prompt 16-A (backup and restore) after P7 and before P10, or right away if the app is already live. Run prompt 17-A (staff login) together with P1, or now if P1 is built.

Settle these open decisions (SPEC.md sections 14 and 15):
- **P2:** distributor model and AI provider.
- **P4:** email provider and deposit and claim rules.
- **P5:** payment provider (it must also handle CNY) and who holds wallet funds.
- **P6:** YunExpress live account.
- **P9:** Octopus Dropship API and the Postman workspace owner.
- **16-A:** off-site backup storage provider (e.g. Cloudflare R2, AWS S3, Backblaze B2), Supabase PITR add-on, and who keeps the offline backup key.

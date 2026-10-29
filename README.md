# Invoicing (Counter Desk app)

A focused invoicing screen on top of ERPNext. Invoicing users see only **Sales Invoice, Payment Entry, Item and Customer** at `/invoicing`.
Everything is saved as normal ERPNext documents, so reports, GL entries, stock and ZATCA behave exactly as they do in the desk.

## What it does
- **Sales Invoice**: draft, live totals (computed by ERPNext), submit, status (Draft / Unpaid / Partly Paid / Overdue / Paid / Return), print with your Print Formats, cancel and return behind a manager PIN, ZATCA status and retry when the ZATCA app is on.
- **Payment Entry**: record a payment from an invoice, allocate across invoices, keep advances, bank references, receipt print, cancel behind a manager PIN.
- **Item**: create and edit with opening stock, barcodes, UOMs, reorder levels, stock by warehouse, stock adjustment.
- **Customer**: create and edit; phone, email and address are stored on Contact and Address.

## Desk mode (what invoicing users get)
Invoicing users work in the normal ERPNext desk, locked to an **Invoicing** workspace (Sales Invoice, Payment Entry, Item, Customer), with a light skin and only the fields listed in `public/js/desk_user.js`. Edit those lists to show more or less. After changing the JS or CSS, bump the `?v=` number in `hooks.py` and clear the cache.
Invoicing Manager can also cancel and amend; Invoicing User cannot. Saving an item with opening stock works without Stock Entry rights (`overrides/item.py`).

## Install
    bench get-app counter_desk <path-or-repo>
    bench --site <site> install-app counter_desk
Then open **Counter Desk Settings** in the desk and set the company, default warehouse, walk-in customer, price list, tax template and **Manager PIN**.

## Users
    bench --site <site> execute counter_desk.setup.install.make_counter_user --kwargs "{'email': 'sara@example.com', 'first_name': 'Sara'}"
Add `'manager': 1` for a Invoicing Manager (can cancel and return without a PIN). Invoicing-only users are redirected from `/app` to `/invoicing` after login.

## Permissions
`Invoicing User`: read/write/create/submit/print on Sales Invoice and Payment Entry, read/write/create on Item and Customer, select-only on the lookup doctypes ERPNext checks while validating. No stock, journal, purchase or setup rights. Stock postings (opening stock, adjustments) and cancellations run through the app's endpoints after checks, not through direct rights.

## Tests
    bench --site <site> run-tests --app counter_desk
`counter_desk/tests/smoke.py` runs the standard ERPNext customer > item > invoice > payment > cancel flow; its output must be identical before and after install.
`counter_desk/tests/demo_data.py` builds a dev company and dev logins. Never run it on a production site.

## Limits
- One company per install (Counter Desk Settings).
- ZATCA: the app shows and retries what `zatca_erpgulf` does; onboarding and signing stay in that app.
- Multi-currency, serial and batch items, and sales orders / delivery notes are not part of this screen.

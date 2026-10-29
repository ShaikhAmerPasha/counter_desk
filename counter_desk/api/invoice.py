"""Sales Invoice endpoints: list, load, live calculation, save, submit, cancel, return, print.
Every number comes from ERPNext's own controller code, so totals, taxes and stock match what the desk would produce."""
import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate, nowtime

from counter_desk.api.common import check_pin_or_manager, company, elevated, settings, zatca_enabled

HEADER = [
    "customer", "company", "cost_center", "posting_date", "posting_time", "set_posting_time", "due_date", "is_pos", "pos_profile", "is_return", "return_against", "amended_from", "po_no", "po_date",
    "currency", "conversion_rate", "selling_price_list", "price_list_currency", "plc_conversion_rate", "ignore_pricing_rule", "update_stock", "set_warehouse", "taxes_and_charges", "shipping_rule", "tax_category",
    "apply_discount_on", "additional_discount_percentage", "discount_amount", "disable_rounded_total", "payment_terms_template", "cash_bank_account", "account_for_change_amount", "write_off_amount",
    "write_off_outstanding_amount_automatically", "write_off_account", "write_off_cost_center", "tc_name", "terms", "customer_address", "contact_person", "territory", "shipping_address_name", "company_address",
    "campaign", "source", "debit_to", "is_opening", "remarks", "sales_partner", "commission_rate", "letter_head", "group_same_items", "select_print_heading", "language", "project",
]
READ = ["name", "docstatus", "status", "customer_name", "tax_id", "modified", "creation", "owner", "address_display", "contact_display", "shipping_address", "total_qty", "total", "net_total", "total_taxes_and_charges",
        "grand_total", "rounding_adjustment", "rounded_total", "in_words", "total_advance", "outstanding_amount", "paid_amount", "change_amount", "total_commission"]
ITEM_W = ["item_code", "qty", "uom", "rate", "discount_percentage", "discount_amount", "warehouse", "description", "price_list_rate", "margin_type", "margin_rate_or_amount", "conversion_factor", "item_tax_template",
          "item_tax_rate", "income_account", "expense_account", "cost_center", "barcode", "allow_zero_valuation_rate", "page_break"]
ITEM_R = ["item_name", "stock_uom", "stock_qty", "rate_with_margin", "amount", "net_rate", "net_amount", "actual_qty"]
TAX_W = ["charge_type", "row_id", "account_head", "description", "included_in_print_rate", "rate", "tax_amount", "cost_center"]
TAX_R = ["total", "tax_amount_after_discount_amount"]
PAY_W = ["mode_of_payment", "amount", "reference_no"]
PAY_R = ["account", "type"]
SCHED_W = ["payment_term", "description", "invoice_portion"]
SCHED_R = ["due_date", "payment_amount"]
CALC_TOTALS = ["total_qty", "total", "net_total", "total_taxes_and_charges", "grand_total", "rounding_adjustment", "rounded_total", "in_words", "total_advance", "outstanding_amount", "paid_amount", "change_amount", "discount_amount", "additional_discount_percentage", "due_date", "total_commission"]
ZATCA = ["custom_zatca_status", "custom_zatca_full_response"]


def _rows(rows, fields):
    return [{f: r.get(f) for f in fields} for r in rows or []]


def _bin_qty(item, wh):
    return flt(frappe.db.get_value("Bin", {"item_code": item, "warehouse": wh}, "actual_qty")) if item and wh else 0


def _timeline(name, dt="Sales Invoice"):
    ev = [{"t": str(frappe.db.get_value(dt, name, "creation"))[:16], "m": "{0} created this".format(frappe.utils.get_fullname(frappe.db.get_value(dt, name, "owner")))}]
    for v in frappe.get_all("Version", filters={"ref_doctype": dt, "docname": name}, fields=["owner", "creation", "data"], order_by="creation asc", limit=30):
        try:
            data = json.loads(v.data or "{}")
        except ValueError:
            data = {}
        ch = [c[0] for c in data.get("changed", [])][:3]
        what = "changed " + ", ".join(ch) if ch else ("edited a row" if data.get("row_changed") or data.get("added") or data.get("removed") else "edited this")
        if "docstatus" in ch:
            what = "changed the document status"
        ev.append({"t": str(v.creation)[:16], "m": "{0} {1}".format(frappe.utils.get_fullname(v.owner), what)})
    for c in frappe.get_all("Comment", filters={"reference_doctype": dt, "reference_name": name, "comment_type": ["in", ["Comment", "Info"]]}, fields=["owner", "creation", "content", "comment_type"], order_by="creation asc", limit=20):
        ev.append({"t": str(c.creation)[:16], "m": "{0}: {1}".format(frappe.utils.get_fullname(c.owner), frappe.utils.strip_html(c.content or ""))})
    return sorted(ev, key=lambda e: e["t"])


def _payments(name):
    return frappe.db.sql("""select pe.name, pe.posting_date, pe.mode_of_payment, per.allocated_amount as amount, pe.reference_no from `tabPayment Entry Reference` per
        join `tabPayment Entry` pe on pe.name = per.parent where per.reference_doctype = 'Sales Invoice' and per.reference_name = %s and pe.docstatus = 1 order by pe.posting_date""", name, as_dict=1)


def _pack(doc, full=True):
    d = {f: doc.get(f) for f in HEADER + READ}
    d["items"] = _rows(doc.items, ITEM_W + ITEM_R)
    d["taxes"] = _rows(doc.taxes, TAX_W + TAX_R)
    d["payments"] = _rows(doc.payments, PAY_W + PAY_R)
    d["payment_schedule"] = _rows(doc.payment_schedule, SCHED_W + SCHED_R)
    for r in d["items"]:
        r["actual_qty"] = _bin_qty(r["item_code"], r["warehouse"])
    if zatca_enabled(doc.company):
        d.update({f: doc.get(f) for f in ZATCA})
    for r in d["items"]:
        for k in ("item_tax_rate",):
            if isinstance(r.get(k), str) and not r[k]:
                r[k] = "{}"
    if full and doc.name:
        d["pay_hist"] = _payments(doc.name)
        d["returns"] = frappe.get_all("Sales Invoice", filters={"return_against": doc.name, "docstatus": 1}, pluck="name")
        d["stock_moves"] = frappe.get_all("Stock Ledger Entry", filters={"voucher_type": "Sales Invoice", "voucher_no": doc.name, "is_cancelled": 0}, fields=["item_code", "warehouse", "actual_qty", "qty_after_transaction"])
        d["timeline"] = _timeline(doc.name)
        d["customer_title"] = doc.customer_name
    return d


def _build(data, name=None):
    """Turn the client payload into a Sales Invoice document. Only whitelisted fields are taken."""
    if name:
        d = frappe.get_doc("Sales Invoice", name)
    else:
        d = frappe.new_doc("Sales Invoice")
    for f in HEADER:
        if f in data and f != "company":
            d.set(f, data[f] if data[f] != "" else None)
    d.company = company()
    if not d.currency:
        d.currency = frappe.get_cached_value("Company", d.company, "default_currency")
    d.conversion_rate = flt(d.conversion_rate) or 1
    d.plc_conversion_rate = flt(d.plc_conversion_rate) or 1
    d.price_list_currency = d.price_list_currency or d.currency
    d.set("items", [])
    for r in data.get("items") or []:
        if r.get("item_code"):
            d.append("items", {f: r.get(f) for f in ITEM_W if r.get(f) not in (None, "")})
    d.set("taxes", [])
    for r in data.get("taxes") or []:
        d.append("taxes", {f: r.get(f) for f in TAX_W if r.get(f) not in (None, "")})
    d.set("payments", [])
    if cint(d.is_pos):
        for r in data.get("payments") or []:
            if r.get("mode_of_payment"):
                row = d.append("payments", {f: r.get(f) for f in PAY_W if r.get(f) not in (None, "")})
                row.type = frappe.db.get_value("Mode of Payment", row.mode_of_payment, "type")  # normally fetched on save; needed now for change-amount maths
    d.set("payment_schedule", [])
    return d


@frappe.whitelist()
def calculate(doc):
    """Recompute totals for the form without saving. Returns only the computed fields."""
    data = frappe.parse_json(doc)
    frappe.has_permission("Sales Invoice", "read", throw=True)
    d = _build(data)
    d.docstatus = 0
    order = [bool(r.get("item_code")) for r in data.get("items") or []]
    if not d.items:
        zero = {f: 0 for f in CALC_TOTALS if f not in ("in_words", "due_date")}
        return zero | {"in_words": "", "due_date": d.due_date or d.posting_date, "items": [{} for _ in order], "taxes": _rows(d.taxes, TAX_W + TAX_R), "payment_schedule": []}
    if cint(d.is_pos):
        d.set_account_for_mode_of_payment()
    d.calculate_taxes_and_totals()
    d.set_total_in_words()
    if d.payment_terms_template and not cint(d.is_pos) and not cint(d.is_return) and d.grand_total:
        d.set_payment_schedule()
        if d.payment_schedule:
            d.due_date = d.payment_schedule[-1].due_date
    elif not d.due_date or getdate(d.due_date) < getdate(d.posting_date):
        d.due_date = d.posting_date
    out = {f: d.get(f) for f in CALC_TOTALS}
    it = iter(d.items)
    out["items"] = [(lambda r: {f: r.get(f) for f in ["amount", "net_amount", "net_rate", "stock_qty", "rate_with_margin"]} | {"actual_qty": _bin_qty(r.item_code, r.warehouse)})(next(it)) if ok else {} for ok in order]
    out["taxes"] = _rows(d.taxes, TAX_W + TAX_R)
    out["payment_schedule"] = _rows(d.payment_schedule, SCHED_W + SCHED_R)
    return out


@frappe.whitelist()
def item_details(item_code, qty=1, uom=None, customer=None, selling_price_list=None, warehouse=None, posting_date=None, update_stock=1, is_return=0):
    from erpnext.stock.get_item_details import get_item_details

    co = company()
    cur = frappe.get_cached_value("Company", co, "default_currency")
    args = {"item_code": item_code, "doctype": "Sales Invoice", "company": co, "customer": customer or None, "selling_price_list": selling_price_list or settings().default_price_list, "currency": cur, "price_list_currency": cur,
            "conversion_rate": 1, "plc_conversion_rate": 1, "qty": flt(qty) or 1, "uom": uom or None, "warehouse": warehouse or None, "set_warehouse": warehouse or None, "transaction_date": posting_date or nowdate(),
            "update_stock": cint(update_stock), "is_pos": 0, "ignore_pricing_rule": 0, "is_return": cint(is_return), "parenttype": "Sales Invoice", "child_doctype": "Sales Invoice Item"}
    out = get_item_details(args)
    item = frappe.get_cached_doc("Item", item_code)
    keep = ["item_name", "description", "uom", "stock_uom", "conversion_factor", "qty", "price_list_rate", "rate", "discount_percentage", "discount_amount", "warehouse", "income_account", "expense_account", "cost_center", "item_tax_template", "item_tax_rate", "margin_type", "margin_rate_or_amount", "barcode"]
    res = {k: out.get(k) for k in keep if k in out}
    # for selling documents ERPNext leaves "rate" to the form: price list rate less any discount
    plr, disc = flt(res.get("price_list_rate")), flt(res.get("discount_percentage"))
    if plr:
        res["rate"] = flt(plr * (1 - disc / 100), 4)
        res["discount_amount"] = flt(plr - res["rate"], 4)
    res["actual_qty"] = _bin_qty(item_code, res.get("warehouse")) if item.is_stock_item else 0
    res["is_stock_item"] = cint(item.is_stock_item)
    res["max_discount"] = flt(item.max_discount)
    if isinstance(res.get("item_tax_rate"), dict):
        res["item_tax_rate"] = json.dumps(res["item_tax_rate"])
    return res


@frappe.whitelist()
def party_details(customer, posting_date=None):
    from erpnext.accounts.party import get_party_details

    frappe.get_doc("Customer", customer).check_permission("read")
    # reads the customer's receivable account, which a counter user may not read directly
    with elevated():
        p = get_party_details(party=customer, party_type="Customer", company=company(), posting_date=posting_date or nowdate(), doctype="Sales Invoice")
    keys = ["customer_name", "tax_id", "selling_price_list", "price_list", "currency", "taxes_and_charges", "payment_terms_template", "customer_address", "address_display", "contact_person", "contact_display", "territory", "tax_category", "debit_to", "shipping_address_name", "shipping_address", "due_date"]
    out = {k: p.get(k) for k in keys if p.get(k) not in (None, "")}
    if "price_list" in out and "selling_price_list" not in out:
        out["selling_price_list"] = out.pop("price_list")
    out.pop("price_list", None)
    out.setdefault("customer_name", frappe.db.get_value("Customer", customer, "customer_name"))
    out.setdefault("tax_id", frappe.db.get_value("Customer", customer, "tax_id") or "")
    return out


@frappe.whitelist()
def tax_rows(template):
    from erpnext.controllers.accounts_controller import get_taxes_and_charges

    if not template:
        return []
    return _rows([frappe._dict(r) for r in get_taxes_and_charges("Sales Taxes and Charges Template", template)], TAX_W)


@frappe.whitelist()
def new_doc(customer=None, item=None):
    s, co = settings(), company()
    c = frappe.get_cached_doc("Company", co)
    wh = s.default_warehouse
    tpl = s.default_tax_template or frappe.db.get_value("Sales Taxes and Charges Template", {"company": co, "is_default": 1, "disabled": 0}, "name")
    d = {"company": co, "cost_center": c.cost_center, "posting_date": nowdate(), "posting_time": nowtime(), "set_posting_time": 0, "due_date": nowdate(), "currency": c.default_currency, "conversion_rate": 1,
         "selling_price_list": s.default_price_list or frappe.db.get_single_value("Selling Settings", "selling_price_list"), "price_list_currency": c.default_currency, "plc_conversion_rate": 1, "ignore_pricing_rule": 0,
         "update_stock": 1 if (cint(s.update_stock_by_default) and wh) else 0, "set_warehouse": wh, "taxes_and_charges": tpl, "taxes": tax_rows(tpl), "apply_discount_on": "Grand Total", "additional_discount_percentage": 0,
         "discount_amount": 0, "disable_rounded_total": cint(s.disable_rounded_total), "debit_to": c.default_receivable_account, "is_pos": 0, "is_return": 0, "account_for_change_amount": c.default_cash_account,
         "cash_bank_account": c.default_cash_account, "write_off_account": c.write_off_account, "write_off_cost_center": c.cost_center, "letter_head": s.default_letter_head, "items": [], "payments": [], "payment_schedule": [],
         "is_opening": "No", "docstatus": 0, "customer": customer or s.default_customer or ""}
    if d["customer"]:
        d.update(party_details(d["customer"]))
        if not d.get("taxes_and_charges"):
            d["taxes_and_charges"] = tpl
        d["taxes"] = tax_rows(d["taxes_and_charges"])
    if item:
        det = item_details(item, 1, None, d["customer"], d["selling_price_list"], wh, None, d["update_stock"])
        d["items"].append(dict(det, item_code=item))
    d.update(calculate(json.dumps(d, default=str)) | {"items": d["items"]})
    calc = calculate(json.dumps(d, default=str))
    for r, cr in zip(d["items"], calc["items"]):
        r.update(cr)
    d["taxes"] = calc["taxes"]
    d.update({k: calc[k] for k in CALC_TOTALS})
    return d


def _prepare(d):
    with elevated():  # fills defaults such as the receivable account, which reads Account records the cashier role cannot
        d.set_missing_values()
    if not d.taxes and d.taxes_and_charges:
        for r in tax_rows(d.taxes_and_charges):
            d.append("taxes", r)
    d.calculate_taxes_and_totals()


@frappe.whitelist()
def save(doc):
    data = frappe.parse_json(doc)
    name = data.get("name")
    if name:
        existing = frappe.get_doc("Sales Invoice", name)
        existing.check_permission("write")
        if existing.docstatus != 0:
            frappe.throw(_("Only draft invoices can be edited."))
        if data.get("modified") and str(existing.modified) != str(data["modified"]):
            frappe.throw(_("This invoice was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
        d = _build(data, name)
    else:
        frappe.has_permission("Sales Invoice", "create", throw=True)
        d = _build(data)
    if not d.customer:
        frappe.throw(_("Customer is required"))
    if not d.items:
        frappe.throw(_("Add at least one item"))
    _prepare(d)
    if name:
        d.save()
    else:
        d.insert()
    return _pack(frappe.get_doc("Sales Invoice", d.name))


@frappe.whitelist()
def get(name):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("read")
    if d.company != company():
        frappe.throw(_("This invoice belongs to another company."), frappe.PermissionError)
    return _pack(d)


@frappe.whitelist()
def submit(name, modified=None):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("submit")
    if modified and str(d.modified) != str(modified):
        frappe.throw(_("This invoice was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
    d.submit()
    return _pack(frappe.get_doc("Sales Invoice", name))


@frappe.whitelist()
def cancel(name, pin=None):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("read")
    check_pin_or_manager(pin)
    d.flags.ignore_permissions = True
    d.cancel()
    d.add_comment("Info", _("Cancelled from Counter Desk by {0} (manager approved).").format(frappe.session.user))
    return _pack(frappe.get_doc("Sales Invoice", name))


@frappe.whitelist()
def delete(name):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("delete")
    if d.docstatus != 0:
        frappe.throw(_("Only draft invoices can be deleted."))
    frappe.delete_doc("Sales Invoice", name)
    return True


def _as_new(d):
    out = _pack(d, full=False)
    for k in ("name", "docstatus", "status", "modified", "creation", "owner", "outstanding_amount", "paid_amount", "change_amount", "custom_zatca_status", "custom_zatca_full_response"):
        out.pop(k, None)
    out.update({"docstatus": 0, "posting_date": nowdate(), "posting_time": nowtime(), "set_posting_time": 0})
    return out


@frappe.whitelist()
def make_return(name, pin=None):
    """Draft credit note against an invoice. Needs manager approval because it gives money back."""
    from erpnext.controllers.sales_and_purchase_return import make_return_doc

    src = frappe.get_doc("Sales Invoice", name)
    src.check_permission("read")
    if src.docstatus != 1:
        frappe.throw(_("Only submitted invoices can be returned."))
    check_pin_or_manager(pin)
    r = make_return_doc("Sales Invoice", name)
    out = _as_new(r)
    out.update({"is_return": 1, "return_against": name, "payment_terms_template": "", "payments": [], "is_pos": cint(src.is_pos)})
    for row in out["items"]:
        row["actual_qty"] = _bin_qty(row["item_code"], row["warehouse"])
    return out | {k: v for k, v in calculate(json.dumps(out, default=str)).items() if k in CALC_TOTALS} | {"naming_series": r.naming_series}


@frappe.whitelist()
def duplicate(name, amend=0):
    src = frappe.get_doc("Sales Invoice", name)
    src.check_permission("read")
    out = _as_new(src)
    out["payments"] = [] if not cint(src.is_pos) else out["payments"]
    if cint(amend):
        if src.docstatus != 2:
            frappe.throw(_("Only cancelled invoices can be amended."))
        out["amended_from"] = name
    else:
        out["amended_from"] = None
    out["return_against"] = src.return_against if src.is_return else None
    out.update({k: v for k, v in calculate(json.dumps(out, default=str)).items() if k in CALC_TOTALS})
    return out


@frappe.whitelist()
def print_html(name=None, doc=None, print_format=None, letter_head=None, lang=None):
    """Server-rendered print preview using the Print Format configured in the desk."""
    frappe.has_permission("Sales Invoice", "print", throw=True)
    if name:
        d = frappe.get_doc("Sales Invoice", name)
        d.check_permission("print")
    else:
        d = _build(frappe.parse_json(doc))
        d.calculate_taxes_and_totals()
        d.set_total_in_words()
        d.name = "(draft)"
        d.docstatus = 0
    fmt = print_format or settings().default_print_format or None
    html = frappe.get_print("Sales Invoice", d.name if name else None, fmt, letterhead=letter_head or None, doc=d, no_letterhead=0 if (letter_head or d.letter_head) else 1)
    return {"html": html, "format": fmt}


@frappe.whitelist()
def zatca(name):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("read")
    if not zatca_enabled(d.company):
        return {"enabled": False}
    return {"enabled": True, "status": d.get("custom_zatca_status"), "response": d.get("custom_zatca_full_response")}


# ------------------------------------------------------------------ list
TABS = {
    "All": {},
    "Draft": {"docstatus": 0},
    "Unpaid": {"docstatus": 1, "status": ["in", ["Unpaid", "Partly Paid"]]},
    "Overdue": {"docstatus": 1, "status": ["in", ["Overdue", "Overdue and Discounted"]]},
    "Paid": {"docstatus": 1, "status": "Paid"},
}
SORTS = {"date": "posting_date {d}, posting_time {d}", "total": "grand_total {d}", "out": "outstanding_amount {d}", "name": "name {d}"}


@frappe.whitelist()
def list(tab="All", txt="", period="All", sort="date", dir="desc", start=0, page_len=30):
    frappe.has_permission("Sales Invoice", "read", throw=True)
    co, z = company(), zatca_enabled()
    base = {"company": co}
    flt_ = dict(base)
    if tab == "ZATCA issues" and z:
        flt_.update({"docstatus": 1, "custom_zatca_status": ["not in", ["REPORTED", "CLEARED", "Reported", "Cleared"]]})
    else:
        flt_.update(TABS.get(tab, {}))
    if period != "All":
        flt_["posting_date"] = [">=", add_days(nowdate(), -cint(period))]
    or_filters = [["Sales Invoice", f, "like", f"%{txt}%"] for f in ("name", "customer", "customer_name")] if txt else None
    d = "asc" if dir == "asc" else "desc"
    fields = ["name", "customer", "customer_name", "posting_date", "posting_time", "grand_total", "outstanding_amount", "status", "docstatus", "is_return", "due_date", "currency"] + (["custom_zatca_status"] if z else [])
    start, page_len = cint(start), min(cint(page_len) or 30, 100)
    rows = frappe.get_all("Sales Invoice", filters=flt_, or_filters=or_filters, fields=fields, order_by=SORTS.get(sort, SORTS["date"]).format(d=d) + ", creation desc", start=start, limit=page_len + 1)
    more = len(rows) > page_len
    counts = {"All": 0, "Draft": 0, "Unpaid": 0, "Overdue": 0, "Paid": 0, "ZATCA issues": 0}
    for r in frappe.get_all("Sales Invoice", filters=base, fields=["docstatus", "status", "count(name) as n"], group_by="docstatus, status"):
        counts["All"] += r.n
        if r.docstatus == 0:
            counts["Draft"] += r.n
        elif r.docstatus == 1:
            if r.status in ("Unpaid", "Partly Paid"):
                counts["Unpaid"] += r.n
            elif r.status in ("Overdue", "Overdue and Discounted"):
                counts["Overdue"] += r.n
            elif r.status == "Paid":
                counts["Paid"] += r.n
    if z:
        counts["ZATCA issues"] = frappe.db.count("Sales Invoice", {**base, "docstatus": 1, "custom_zatca_status": ["not in", ["REPORTED", "CLEARED", "Reported", "Cleared"]]})
    return {"rows": rows[:page_len], "more": more, "counts": counts, "kpis": kpis(co), "zatca": z}


def kpis(co):
    today = nowdate()
    live = {"company": co, "docstatus": 1, "is_return": 0}
    sales = frappe.get_all("Sales Invoice", filters={**live, "posting_date": today}, fields=["count(name) as n", "sum(grand_total) as amt"])[0]
    open_ = frappe.get_all("Sales Invoice", filters={**live, "outstanding_amount": [">", 0.005]}, fields=["outstanding_amount", "due_date"])
    b = {"current": 0.0, "d30": 0.0, "d31": 0.0}
    for r in open_:
        late = (getdate(today) - getdate(r.due_date)).days if r.due_date else 0
        b["current" if late <= 0 else "d30" if late <= 30 else "d31"] += flt(r.outstanding_amount)
    return {"sales_today": flt(sales.amt), "sales_today_n": cint(sales.n), "to_collect": sum(b.values()), "open_n": len(open_), "overdue": b["d30"] + b["d31"], "aging": b,
            "drafts": frappe.db.count("Sales Invoice", {"company": co, "docstatus": 0})}

"""Payment Entry (money received from customers): list, load, save, submit, cancel, print. Allocation rules are ERPNext's own."""
import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from counter_desk.api.common import check_pin_or_manager, company, elevated, settings
from counter_desk.api.invoice import _timeline

HEADER = ["posting_date", "mode_of_payment", "party", "paid_from", "paid_to", "paid_amount", "received_amount", "reference_no", "reference_date", "remarks", "cost_center", "project"]
READ = ["name", "docstatus", "status", "party_name", "company", "payment_type", "total_allocated_amount", "unallocated_amount", "difference_amount", "modified", "creation", "owner"]
REF_W = ["reference_doctype", "reference_name", "allocated_amount"]
REF_R = ["due_date", "total_amount", "outstanding_amount"]


def _mop_account(mode):
    acct = frappe.db.get_value("Mode of Payment Account", {"parent": mode, "company": company()}, "default_account")
    if not acct:
        frappe.throw(_("Mode of Payment {0} has no account for {1}.").format(mode, company()))
    return acct


def _pack(doc, full=True):
    d = {f: doc.get(f) for f in HEADER + READ}
    d["references"] = [{f: r.get(f) for f in REF_W + REF_R} for r in doc.references]
    if full and doc.name:
        d["timeline"] = _timeline(doc.name, "Payment Entry")
    return d


def _build(data, name=None):
    d = frappe.get_doc("Payment Entry", name) if name else frappe.new_doc("Payment Entry")
    for f in HEADER:
        if f in data:
            d.set(f, data[f] if data[f] != "" else None)
    d.payment_type, d.party_type, d.company = "Receive", "Customer", company()
    if not d.posting_date:
        d.posting_date = nowdate()
    if d.mode_of_payment:
        d.paid_to = d.paid_to or _mop_account(d.mode_of_payment)
    if d.party and not d.paid_from:
        from erpnext.accounts.party import get_party_account

        with elevated():
            d.paid_from = get_party_account("Customer", d.party, d.company)
    d.paid_to_account_currency = d.paid_from_account_currency = frappe.get_cached_value("Company", d.company, "default_currency")
    d.source_exchange_rate = d.target_exchange_rate = 1
    d.received_amount = flt(d.paid_amount)
    d.set("references", [])
    for r in data.get("references") or []:
        if r.get("reference_name"):
            d.append("references", {"reference_doctype": "Sales Invoice", "reference_name": r["reference_name"], "allocated_amount": flt(r.get("allocated_amount"))})
    return d


def open_invoices(party):
    return frappe.get_all("Sales Invoice", filters={"company": company(), "customer": party, "docstatus": 1, "is_return": 0, "outstanding_amount": [">", 0.005]},
                          fields=["name", "due_date", "grand_total", "outstanding_amount", "posting_date"], order_by="due_date asc, posting_date asc")


@frappe.whitelist()
def invoice_options(party=None, txt=""):
    """Open invoices for the link box in the references grid."""
    frappe.has_permission("Payment Entry", "read", throw=True)
    flt_ = {"company": company(), "docstatus": 1, "is_return": 0, "outstanding_amount": [">", 0.005]}
    if party:
        flt_["customer"] = party
    or_ = [["Sales Invoice", f, "like", f"%{txt}%"] for f in ("name", "customer_name")] if txt else None
    return frappe.get_all("Sales Invoice", filters=flt_, or_filters=or_, fields=["name", "customer", "customer_name", "outstanding_amount", "due_date", "grand_total"], order_by="due_date asc", limit=20)


@frappe.whitelist()
def invoice_row(name):
    inv = frappe.get_doc("Sales Invoice", name)
    inv.check_permission("read")
    return {"reference_name": name, "due_date": inv.due_date, "total_amount": inv.grand_total, "outstanding_amount": inv.outstanding_amount, "customer": inv.customer, "customer_name": inv.customer_name}


@frappe.whitelist()
def get_outstanding(party, paid_amount=0):
    """Open invoices for a customer, oldest due first, with the amount allocated from the money received."""
    frappe.has_permission("Payment Entry", "read", throw=True)
    rows = open_invoices(party)
    total = sum(flt(r.outstanding_amount) for r in rows)
    paid = flt(paid_amount) or total
    left, refs = paid, []
    for r in rows:
        a = min(flt(r.outstanding_amount), max(left, 0))
        left -= a
        refs.append({"reference_doctype": "Sales Invoice", "reference_name": r.name, "due_date": r.due_date, "total_amount": r.grand_total, "outstanding_amount": r.outstanding_amount, "allocated_amount": flt(a, 2)})
    return {"paid_amount": paid, "references": refs}


@frappe.whitelist()
def new_from_invoice(invoice):
    """Draft payment for one invoice, built by ERPNext so the accounts are the ones the desk would choose."""
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    inv = frappe.get_doc("Sales Invoice", invoice)
    inv.check_permission("read")
    if inv.docstatus != 1 or flt(inv.outstanding_amount) <= 0.005 or inv.is_return:
        frappe.throw(_("{0} has nothing left to collect.").format(invoice))
    with elevated():
        pe = get_payment_entry("Sales Invoice", invoice)
    d = _pack(pe, full=False)
    for k in ("name", "docstatus", "status", "modified", "creation", "owner"):
        d.pop(k, None)
    # start with cash (no reference needed); the cashier can switch the mode, which re-points the account
    d.update({"docstatus": 0, "mode_of_payment": "Cash", "posting_date": nowdate(), "paid_to": _mop_account("Cash"), "party_name": inv.customer_name, "reference_no": "", "reference_date": None})
    return d


@frappe.whitelist()
def new_doc(party=None):
    d = {"docstatus": 0, "posting_date": nowdate(), "mode_of_payment": "Cash", "party": party or "", "party_name": "", "paid_amount": 0, "received_amount": 0, "references": [], "total_allocated_amount": 0, "unallocated_amount": 0,
         "reference_no": "", "reference_date": None, "remarks": "", "cost_center": frappe.get_cached_value("Company", company(), "cost_center"), "company": company(), "payment_type": "Receive", "paid_to": None, "paid_from": None}
    modes = frappe.get_all("Mode of Payment Account", filters={"parent": "Cash", "company": company()}, pluck="default_account")
    d["paid_to"] = modes[0] if modes else None
    if party:
        d["party_name"] = frappe.db.get_value("Customer", party, "customer_name")
    return d


def _check(d):
    if not d.party:
        frappe.throw(_("Customer is required"))
    if flt(d.paid_amount) <= 0:
        frappe.throw(_("Amount received must be above zero"))
    if not d.mode_of_payment:
        frappe.throw(_("Mode of Payment is required"))
    t = frappe.db.get_value("Mode of Payment", d.mode_of_payment, "type")
    if t == "Bank" and (not d.reference_no or not d.reference_date):
        frappe.throw(_("Reference No and Reference Date are mandatory for bank payments"))
    for r in d.references:
        if flt(r.allocated_amount) <= 0:
            frappe.throw(_("Row {0}: allocated amount must be above zero").format(r.idx))


@frappe.whitelist()
def save(doc):
    data = frappe.parse_json(doc)
    name = data.get("name")
    if name:
        ex = frappe.get_doc("Payment Entry", name)
        ex.check_permission("write")
        if ex.docstatus != 0:
            frappe.throw(_("Only draft payments can be edited."))
        if data.get("modified") and str(ex.modified) != str(data["modified"]):
            frappe.throw(_("This payment was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
        d = _build(data, name)
    else:
        frappe.has_permission("Payment Entry", "create", throw=True)
        d = _build(data)
    _check(d)
    d.save() if name else d.insert()
    return _pack(frappe.get_doc("Payment Entry", d.name))


@frappe.whitelist()
def get(name):
    d = frappe.get_doc("Payment Entry", name)
    d.check_permission("read")
    if d.company != company():
        frappe.throw(_("This payment belongs to another company."), frappe.PermissionError)
    return _pack(d)


@frappe.whitelist()
def submit(name, modified=None):
    d = frappe.get_doc("Payment Entry", name)
    d.check_permission("submit")
    if modified and str(d.modified) != str(modified):
        frappe.throw(_("This payment was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
    d.submit()
    return _pack(frappe.get_doc("Payment Entry", name))


@frappe.whitelist()
def cancel(name, pin=None):
    d = frappe.get_doc("Payment Entry", name)
    d.check_permission("read")
    check_pin_or_manager(pin)
    d.flags.ignore_permissions = True
    d.cancel()
    d.add_comment("Info", _("Cancelled from Counter Desk by {0} (manager approved).").format(frappe.session.user))
    return _pack(frappe.get_doc("Payment Entry", name))


@frappe.whitelist()
def delete(name):
    d = frappe.get_doc("Payment Entry", name)
    d.check_permission("delete")
    if d.docstatus != 0:
        frappe.throw(_("Only draft payments can be deleted."))
    frappe.delete_doc("Payment Entry", name)
    return True


@frappe.whitelist()
def print_html(name=None, doc=None, print_format=None, letter_head=None):
    frappe.has_permission("Payment Entry", "print", throw=True)
    if name:
        d = frappe.get_doc("Payment Entry", name)
        d.check_permission("print")
    else:
        d = _build(frappe.parse_json(doc))
        d.name, d.docstatus = "(draft)", 0
        d.total_allocated_amount = sum(flt(r.allocated_amount) for r in d.references)
        d.unallocated_amount = flt(d.paid_amount) - d.total_allocated_amount
    html = frappe.get_print("Payment Entry", name, print_format or None, letterhead=letter_head or None, doc=d, no_letterhead=0 if letter_head else 1)
    return {"html": html}


TABS = {"All": {}, "Draft": {"docstatus": 0}, "Submitted": {"docstatus": 1}, "Cancelled": {"docstatus": 2}}


@frappe.whitelist()
def list(tab="All", txt="", period="All", start=0, page_len=30):
    frappe.has_permission("Payment Entry", "read", throw=True)
    co = company()
    flt_ = {"company": co, "payment_type": "Receive", **TABS.get(tab, {})}
    if period != "All":
        flt_["posting_date"] = [">=", add_days(nowdate(), -cint(period))]
    or_ = [["Payment Entry", f, "like", f"%{txt}%"] for f in ("name", "party", "party_name", "reference_no")] if txt else None
    start, page_len = cint(start), min(cint(page_len) or 30, 100)
    rows = frappe.get_all("Payment Entry", filters=flt_, or_filters=or_, fields=["name", "party", "party_name", "posting_date", "mode_of_payment", "paid_amount", "unallocated_amount", "docstatus", "status", "reference_no"], order_by="posting_date desc, creation desc", start=start, limit=page_len + 1)
    more = len(rows) > page_len
    rows = rows[:page_len]
    refs = frappe.get_all("Payment Entry Reference", filters={"parent": ["in", [r.name for r in rows]]}, fields=["parent", "reference_name"]) if rows else []
    for r in rows:
        r["applied"] = [x.reference_name for x in refs if x.parent == r.name]
    counts = {"All": 0, "Draft": 0, "Submitted": 0, "Cancelled": 0}
    for r in frappe.get_all("Payment Entry", filters={"company": co, "payment_type": "Receive"}, fields=["docstatus", "count(name) as n"], group_by="docstatus"):
        counts["All"] += r.n
        counts[["Draft", "Submitted", "Cancelled"][r.docstatus]] = r.n
    live = {"company": co, "payment_type": "Receive", "docstatus": 1}
    today = frappe.get_all("Payment Entry", filters={**live, "posting_date": nowdate()}, fields=["count(name) as n", "sum(paid_amount) as amt"])[0]
    week = frappe.get_all("Payment Entry", filters={**live, "posting_date": [">=", add_days(nowdate(), -6)]}, fields=["sum(paid_amount) as amt"])[0]
    adv = frappe.get_all("Payment Entry", filters=live, fields=["sum(unallocated_amount) as amt"])[0]
    due = frappe.get_all("Sales Invoice", filters={"company": co, "docstatus": 1, "is_return": 0, "outstanding_amount": [">", 0.005]}, fields=["count(name) as n", "sum(outstanding_amount) as amt"])[0]
    return {"rows": rows, "more": more, "counts": counts, "kpis": {"today": flt(today.amt), "today_n": cint(today.n), "week": flt(week.amt), "unallocated": flt(adv.amt), "to_collect": flt(due.amt), "open_n": cint(due.n)}}

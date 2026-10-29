"""Customer list and form. Phone, email and address are kept on the standard Contact and Address records."""
import re

import frappe
from frappe import _
from frappe.utils import cint, flt

from counter_desk.api.common import company, elevated, settings

FIELDS = ["customer_name", "customer_type", "customer_group", "territory", "tax_id", "disabled", "default_price_list", "default_currency", "payment_terms", "customer_details"]


def _outstanding(names):
    if not names:
        return {}
    rows = frappe.get_all("Sales Invoice", filters={"customer": ["in", names], "docstatus": 1, "company": company(), "outstanding_amount": [">", 0]}, fields=["customer", "sum(outstanding_amount) as amt"], group_by="customer")
    return {r.customer: flt(r.amt) for r in rows}


@frappe.whitelist()
def list(txt="", group="", start=0, page_len=30):
    frappe.has_permission("Customer", "read", throw=True)
    start, page_len = cint(start), min(cint(page_len) or 30, 100)
    filters = {"disabled": 0}
    if group and group != "All":
        filters["customer_group"] = group
    or_filters = [["Customer", f, "like", f"%{txt}%"] for f in ("name", "customer_name", "tax_id", "mobile_no")] if txt else None
    rows = frappe.get_all("Customer", filters=filters, or_filters=or_filters, fields=["name", "customer_name", "customer_group", "tax_id", "mobile_no", "territory"], order_by="modified desc", start=start, limit=page_len + 1)
    more = len(rows) > page_len
    rows = rows[:page_len]
    out = _outstanding([r.name for r in rows])
    for r in rows:
        r["outstanding"] = out.get(r.name, 0)
    return {"rows": rows, "more": more, "total": frappe.db.count("Customer", {"disabled": 0})}


def _primary(doc):
    addr = frappe.db.get_value("Address", doc.customer_primary_address, ["address_line1", "city", "country"], as_dict=1) if doc.customer_primary_address else None
    con = frappe.db.get_value("Contact", doc.customer_primary_contact, ["email_id", "mobile_no"], as_dict=1) if doc.customer_primary_contact else None
    return addr or {}, con or {}


def _pack(doc):
    d = {f: doc.get(f) for f in ["name"] + FIELDS}
    addr, con = _primary(doc)
    d.update({"address_line1": addr.get("address_line1") or "", "city": "" if addr.get("city") in (None, "-") else addr.get("city"), "country": addr.get("country") or frappe.get_cached_value("Company", company(), "country"), "mobile_no": con.get("mobile_no") or doc.mobile_no or "", "email_id": con.get("email_id") or doc.email_id or ""})
    inv = frappe.get_all("Sales Invoice", filters={"customer": doc.name, "docstatus": 1, "company": company()}, fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"], order_by="posting_date desc, creation desc", limit=5)
    tot = frappe.get_all("Sales Invoice", filters={"customer": doc.name, "docstatus": 1, "company": company()}, fields=["count(name) as n", "sum(grand_total) as billed", "sum(outstanding_amount) as due"])[0]
    d["summary"] = {"invoices": cint(tot.n), "billed": flt(tot.billed), "outstanding": flt(tot.due), "recent": inv}
    d["modified"] = str(doc.modified)
    return d


@frappe.whitelist()
def get(name):
    doc = frappe.get_doc("Customer", name)
    doc.check_permission("read")
    return _pack(doc)


def _check_tax_id(v):
    v = (v or "").strip()
    if v and not re.fullmatch(r"3\d{13}3", v):
        frappe.throw(_("VAT number must be 15 digits, starting and ending with 3."))
    return v


def _sync_contact_address(doc, data):
    """Create or update the primary Contact and Address so phone, email and address stay on the standard records."""
    phone, email = (data.get("mobile_no") or "").strip(), (data.get("email_id") or "").strip()
    line, city, country = (data.get("address_line1") or "").strip(), (data.get("city") or "").strip(), data.get("country") or None
    with elevated():
        if phone or email:
            if doc.customer_primary_contact:
                c = frappe.get_doc("Contact", doc.customer_primary_contact)
            else:
                c = frappe.new_doc("Contact")
                c.first_name = doc.customer_name
                c.append("links", {"link_doctype": "Customer", "link_name": doc.name})
            c.email_ids, c.phone_nos = [], []
            if email:
                c.append("email_ids", {"email_id": email, "is_primary": 1})
            if phone:
                c.append("phone_nos", {"phone": phone, "is_primary_mobile_no": 1})
            c.save() if c.name else c.insert()
            if doc.customer_primary_contact != c.name:
                frappe.db.set_value("Customer", doc.name, "customer_primary_contact", c.name)
        if line:
            if doc.customer_primary_address:
                a = frappe.get_doc("Address", doc.customer_primary_address)
                a.address_line1, a.city = line, city or a.city
                if country:
                    a.country = country
                a.save()
            else:
                a = frappe.get_doc({"doctype": "Address", "address_title": doc.customer_name, "address_type": "Billing", "address_line1": line, "city": city or "-", "country": country or frappe.get_cached_value("Company", company(), "country"), "links": [{"link_doctype": "Customer", "link_name": doc.name}]}).insert()
                frappe.db.set_value("Customer", doc.name, "customer_primary_address", a.name)


@frappe.whitelist()
def save(doc):
    data = frappe.parse_json(doc)
    new = not data.get("name")
    data["tax_id"] = _check_tax_id(data.get("tax_id"))
    if new:
        frappe.has_permission("Customer", "create", throw=True)
        d = frappe.new_doc("Customer")
        if not (data.get("customer_name") or "").strip():
            frappe.throw(_("Customer Name is required"))
        d.customer_group = data.get("customer_group") or frappe.db.get_single_value("Selling Settings", "customer_group")
        d.territory = data.get("territory") or frappe.db.get_single_value("Selling Settings", "territory")
        if not d.customer_group or not d.territory:
            frappe.throw(_("Customer Group and Territory are required"))
    else:
        d = frappe.get_doc("Customer", data["name"])
        d.check_permission("write")
        if data.get("modified") and str(d.modified) != str(data["modified"]):
            frappe.throw(_("This customer was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
    for f in FIELDS:
        if f in data and not (f == "customer_name" and not new):
            d.set(f, data[f])
    d.customer_type = d.customer_type or "Individual"
    d.save() if not new else d.insert()
    _sync_contact_address(d, data)
    d.reload()
    return _pack(d)

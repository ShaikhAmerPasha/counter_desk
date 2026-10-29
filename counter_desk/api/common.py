"""Shared helpers and the boot / link-search endpoints used by every Counter Desk screen."""
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate
from frappe.utils.password import get_decrypted_password

MANAGER_ROLES = {"Invoicing Manager", "System Manager", "Accounts Manager", "Sales Manager"}
DOC_TYPES = ("Sales Invoice", "Payment Entry", "Item", "Customer")


def settings():
    return frappe.get_cached_doc("Counter Desk Settings")


def company():
    s = settings()
    name = s.company or frappe.defaults.get_global_default("company")
    if not name:
        frappe.throw(_("Set a company in Counter Desk Settings first."))
    return name


def is_manager():
    return bool(set(frappe.get_roles()) & MANAGER_ROLES)


def zatca_enabled(company_name=None):
    """ZATCA UI is only shown when the ZATCA app's fields exist and the company has e-invoicing on."""
    if not frappe.get_meta("Sales Invoice").has_field("custom_zatca_status"):
        return False
    co = company_name or company()
    return bool(frappe.get_meta("Company").has_field("custom_zatca_invoice_enabled") and frappe.db.get_value("Company", co, "custom_zatca_invoice_enabled"))


@contextmanager
def elevated():
    """Run a short block as Administrator (stock postings the cashier role may not do directly), then restore the user."""
    user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        yield
    finally:
        frappe.set_user(user)


def check_pin_or_manager(pin=None):
    """Managers pass. Others must supply the PIN set in Counter Desk Settings."""
    if is_manager():
        return True
    stored = get_decrypted_password("Counter Desk Settings", "Counter Desk Settings", "manager_pin", raise_exception=False)
    if not stored:
        frappe.throw(_("No manager PIN is set. Ask an administrator to set one in Counter Desk Settings."), frappe.PermissionError)
    if not pin or str(pin) != stored:
        frappe.throw(_("Wrong manager PIN."), frappe.PermissionError)
    return True


def can(doctype, ptype):
    return bool(frappe.has_permission(doctype, ptype))


@frappe.whitelist()
def boot():
    frappe.only_for(("Invoicing User", "Invoicing Manager", "System Manager", "Sales Manager", "Accounts Manager", "Accounts User", "Stock Manager", "Stock User"))
    s = settings()
    co = company()
    cdoc = frappe.get_cached_doc("Company", co)
    abbr = cdoc.abbr
    wh = frappe.get_all("Warehouse", filters={"company": co, "is_group": 0, "disabled": 0}, pluck="name", order_by="name")
    tax = []
    for t in frappe.get_all("Sales Taxes and Charges Template", filters={"company": co, "disabled": 0}, fields=["name", "is_default"]):
        rows = frappe.get_all("Sales Taxes and Charges", filters={"parent": t.name}, fields=["rate", "charge_type"])
        tax.append({"name": t.name, "is_default": t.is_default, "rate": sum(flt(r.rate) for r in rows if r.charge_type == "On Net Total")})
    modes = []
    for m in frappe.get_all("Mode of Payment", filters={"enabled": 1}, fields=["name", "type"], order_by="name"):
        # only modes with an account for this company can be used on an invoice
        acct = frappe.db.get_value("Mode of Payment Account", {"parent": m.name, "company": co}, "default_account")
        if acct:
            modes.append({"name": m.name, "type": m.type, "account": acct})
    addr = ""
    link = frappe.db.get_value("Dynamic Link", {"link_doctype": "Company", "link_name": co, "parenttype": "Address"}, "parent")
    if link:
        a = frappe.db.get_value("Address", link, ["address_line1", "city", "country"], as_dict=1)
        addr = ", ".join(x for x in (a.address_line1, a.city, a.country) if x)
    return {
        "today": nowdate(),
        "user": {"name": frappe.session.user, "full_name": frappe.utils.get_fullname(), "roles": frappe.get_roles(), "is_manager": is_manager()},
        "company": {"name": co, "abbr": abbr, "currency": cdoc.default_currency, "tax_id": cdoc.tax_id, "address": addr, "logo": cdoc.company_logo, "cost_center": cdoc.cost_center, "country": cdoc.country},
        "settings": {
            "warehouse": s.default_warehouse or (wh[0] if wh else ""), "customer": s.default_customer, "price_list": s.default_price_list or frappe.db.get_single_value("Selling Settings", "selling_price_list"),
            "tax_template": s.default_tax_template or next((t["name"] for t in tax if t["is_default"]), ""), "update_stock": cint(s.update_stock_by_default), "disable_rounded_total": cint(s.disable_rounded_total),
            "letter_head": s.default_letter_head, "print_format": s.default_print_format,
        },
        "warehouses": wh,
        "price_lists": frappe.get_all("Price List", filters={"selling": 1, "enabled": 1}, pluck="name"),
        "tax_templates": tax,
        "modes_of_payment": modes,
        "uoms": frappe.get_all("UOM", filters={"enabled": 1}, pluck="name", order_by="name", limit=200),
        "item_groups": frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name"),
        "customer_groups": frappe.get_all("Customer Group", filters={"is_group": 0}, pluck="name", order_by="name"),
        "territories": frappe.get_all("Territory", filters={"is_group": 0}, pluck="name", order_by="name"),
        "payment_terms": frappe.get_all("Payment Terms Template", pluck="name", order_by="name"),
        "letter_heads": frappe.get_all("Letter Head", filters={"disabled": 0}, pluck="name"),
        "print_formats": {
            dt: frappe.get_all("Print Format", filters={"doc_type": dt, "disabled": 0}, pluck="name", order_by="name")
            for dt in ("Sales Invoice", "Payment Entry")
        },
        "zatca": zatca_enabled(co),
        "item_naming_by": frappe.db.get_single_value("Stock Settings", "item_naming_by"),
        "can": {dt: {p: can(dt, p) for p in ("create", "write", "submit", "cancel", "delete", "print")} for dt in DOC_TYPES},
    }


# Link fields in the UI may only search these, and only the listed field set is returned.
LINK_SOURCES = {
    "Customer": {"fields": ["name", "customer_name", "customer_group", "tax_id"], "search": ["name", "customer_name", "tax_id", "mobile_no"], "filters": {"disabled": 0}},
    "Item": {"fields": ["name", "item_name", "item_group", "stock_uom"], "search": ["name", "item_name"], "filters": {"disabled": 0, "is_sales_item": 1}},
    "Warehouse": {"fields": ["name"], "search": ["name"], "filters": {"is_group": 0, "disabled": 0}, "company": 1},
    "UOM": {"fields": ["name"], "search": ["name"], "filters": {"enabled": 1}},
    "Item Group": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Brand": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Price List": {"fields": ["name"], "search": ["name"], "filters": {"selling": 1, "enabled": 1}},
    "Mode of Payment": {"fields": ["name", "type"], "search": ["name"], "filters": {"enabled": 1}},
    "Account": {"fields": ["name", "account_type"], "search": ["name"], "filters": {"is_group": 0, "disabled": 0}, "company": 1},
    "Cost Center": {"fields": ["name"], "search": ["name"], "filters": {"is_group": 0, "disabled": 0}, "company": 1},
    "Currency": {"fields": ["name"], "search": ["name"], "filters": {"enabled": 1}},
    "Sales Taxes and Charges Template": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}, "company": 1},
    "Payment Terms Template": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Terms and Conditions": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0, "selling": 1}},
    "Letter Head": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}},
    "Print Heading": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Territory": {"fields": ["name"], "search": ["name"], "filters": {"is_group": 0}},
    "Customer Group": {"fields": ["name"], "search": ["name"], "filters": {"is_group": 0}},
    "Country": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Shipping Rule": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}},
    "Tax Category": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}},
    "Item Tax Template": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}, "company": 1},
    "Campaign": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Lead Source": {"fields": ["name"], "search": ["name"], "filters": {}},
    "Sales Partner": {"fields": ["name"], "search": ["name"], "filters": {"enabled": 1}},
    "Project": {"fields": ["name"], "search": ["name"], "filters": {}},
    "POS Profile": {"fields": ["name"], "search": ["name"], "filters": {"disabled": 0}},
    "Address": {"fields": ["name", "address_line1"], "search": ["name", "address_line1"], "filters": {"disabled": 0}},
    "Contact": {"fields": ["name"], "search": ["name"], "filters": {}},
}


@frappe.whitelist()
def link_search(doctype, txt="", filters=None, limit=20):
    src = LINK_SOURCES.get(doctype)
    if not src:
        frappe.throw(_("{0} cannot be searched here").format(doctype), frappe.PermissionError)
    frappe.only_for(("Invoicing User", "Invoicing Manager", "System Manager", "Sales Manager", "Accounts Manager", "Accounts User", "Stock Manager", "Stock User"))
    flt_ = dict(src["filters"])
    if src.get("company"):
        flt_["company"] = company()
    extra = frappe.parse_json(filters) if filters else {}
    for k, v in (extra or {}).items():
        if k in ("account_type", "type", "customer", "link_name"):
            flt_[k] = v
    meta = frappe.get_meta(doctype)
    flt_ = {k: v for k, v in flt_.items() if k == "name" or meta.has_field(k)}
    fields = [f for f in src["fields"] if f == "name" or meta.has_field(f)]
    or_filters = [[doctype, f, "like", f"%{txt}%"] for f in src["search"] if f == "name" or meta.has_field(f)] if txt else None
    if doctype == "Item" and txt:  # scanning a barcode finds the item too
        codes = frappe.get_all("Item Barcode", filters={"barcode": ["like", f"%{txt}%"]}, pluck="parent", limit=10)
        if codes:
            or_filters.append([doctype, "name", "in", codes])
    rows = frappe.get_all(doctype, filters=flt_, or_filters=or_filters, fields=fields, limit=min(cint(limit) or 20, 50), order_by="modified desc")
    return rows

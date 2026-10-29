"""Item list, form load/save, stock summary and stock adjustment for the Counter Desk Items screen."""
import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate, nowtime

from counter_desk.api.common import company, elevated, settings

# Fields the counter screen may write. Anything else in the payload is ignored.
ITEM_FIELDS = [
    "item_name", "item_group", "stock_uom", "disabled", "allow_alternative_item", "is_stock_item", "include_item_in_manufacturing", "valuation_rate", "brand", "description",
    "shelf_life_in_days", "end_of_life", "valuation_method", "warranty_period", "weight_per_unit", "weight_uom", "has_batch_no", "create_new_batch", "has_expiry_date",
    "has_serial_no", "serial_no_series", "sales_uom", "is_sales_item", "max_discount", "grant_commission", "allow_negative_stock",
]
CHILD_FIELDS = {
    "barcodes": ["barcode", "barcode_type", "uom"],
    "uoms": ["uom", "conversion_factor"],
    "reorder_levels": ["warehouse", "warehouse_reorder_level", "warehouse_reorder_qty", "material_request_type"],
    "taxes": ["item_tax_template", "tax_category", "valid_from", "minimum_net_rate"],
}
DEFAULT_FIELDS = ["company", "default_warehouse", "default_price_list", "income_account", "selling_cost_center"]


def _whs():
    return frappe.get_all("Warehouse", filters={"company": company(), "is_group": 0}, pluck="name")


def _price_list():
    return settings().default_price_list or frappe.db.get_single_value("Selling Settings", "selling_price_list")


def _rates(names):
    if not names:
        return {}
    rows = frappe.get_all("Item Price", filters={"item_code": ["in", names], "price_list": _price_list(), "selling": 1}, fields=["item_code", "price_list_rate"], order_by="modified asc")
    return {r.item_code: flt(r.price_list_rate) for r in rows}


def _qty(names):
    if not names:
        return {}
    rows = frappe.get_all("Bin", filters={"item_code": ["in", names], "warehouse": ["in", _whs()]}, fields=["item_code", "sum(actual_qty) as qty"], group_by="item_code")
    return {r.item_code: flt(r.qty) for r in rows}


def _reorder(names):
    rows = frappe.get_all("Item Reorder", filters={"parent": ["in", names], "warehouse": ["in", _whs()]}, fields=["parent", "max(warehouse_reorder_level) as lvl"], group_by="parent") if names else []
    return {r.parent: flt(r.lvl) for r in rows}


@frappe.whitelist()
def list(txt="", group="", stock="All", start=0, page_len=30):
    frappe.has_permission("Item", "read", throw=True)
    start, page_len = cint(start), min(cint(page_len) or 30, 100)
    filters, or_filters = {}, None
    if group and group != "All":
        filters["item_group"] = group
    if stock == "Disabled":
        filters["disabled"] = 1
    else:
        filters["disabled"] = 0
    if txt:
        codes = frappe.get_all("Item Barcode", filters={"barcode": ["like", f"%{txt}%"]}, pluck="parent", limit=20)
        or_filters = [["Item", "name", "like", f"%{txt}%"], ["Item", "item_name", "like", f"%{txt}%"]] + ([["Item", "name", "in", codes]] if codes else [])
    # stock filters need quantities, so pull a wider page and filter in Python only when asked
    wide = stock in ("In stock", "Low / out of stock")
    rows = frappe.get_all("Item", filters=filters, or_filters=or_filters, fields=["name", "item_name", "item_group", "stock_uom", "is_stock_item", "disabled"], order_by="modified desc", start=0 if wide else start, limit=500 if wide else page_len + 1)
    names = [r.name for r in rows]
    qty, rate, lvl = _qty(names), _rates(names), _reorder(names)
    out = []
    for r in rows:
        q = qty.get(r.name, 0)
        r.update({"qty": q, "rate": rate.get(r.name, 0), "reorder": lvl.get(r.name, 0)})
        if wide:
            if r.is_stock_item and ((stock == "In stock" and q > 0) or (stock != "In stock" and q <= max(r.reorder, 0))):
                out.append(r)
        else:
            out.append(r)
    more = False
    if wide:
        out = out[start:start + page_len + 1]
    if len(out) > page_len:
        more, out = True, out[:page_len]
    return {"rows": out, "more": more, "total": frappe.db.count("Item", {"disabled": 0})}


def _stock(name, is_stock):
    if not is_stock:
        return {"bins": [], "moves": []}
    whs = _whs()
    bins = frappe.get_all("Bin", filters={"item_code": name, "warehouse": ["in", whs]}, fields=["warehouse", "actual_qty", "reserved_qty", "projected_qty", "valuation_rate"])
    seen = {b.warehouse for b in bins}
    bins += [frappe._dict(warehouse=w, actual_qty=0, reserved_qty=0, projected_qty=0, valuation_rate=0) for w in whs if w not in seen]
    lvl = {r.warehouse: flt(r.warehouse_reorder_level) for r in frappe.get_all("Item Reorder", filters={"parent": name}, fields=["warehouse", "warehouse_reorder_level"])}
    for b in bins:
        b["reorder_level"] = lvl.get(b.warehouse, 0)
    moves = frappe.get_all("Stock Ledger Entry", filters={"item_code": name, "warehouse": ["in", whs], "is_cancelled": 0}, fields=["posting_date", "voucher_type", "voucher_no", "warehouse", "actual_qty", "qty_after_transaction"], order_by="posting_date desc, posting_time desc, creation desc", limit=10)
    return {"bins": sorted(bins, key=lambda b: b.warehouse), "moves": moves}


def _pack(doc):
    co = company()
    d = {f: doc.get(f) for f in ["name", "item_code"] + ITEM_FIELDS}
    for t, fs in CHILD_FIELDS.items():
        d[t] = [{f: r.get(f) for f in fs} for r in doc.get(t)]
    d["item_defaults"] = [{f: r.get(f) for f in DEFAULT_FIELDS} for r in doc.item_defaults if r.company == co]
    d["standard_rate"] = _rates([doc.name]).get(doc.name, 0)
    d["opening_stock"] = 0
    d["stock"] = _stock(doc.name, doc.is_stock_item)
    d["has_transactions"] = bool(frappe.db.exists("Stock Ledger Entry", {"item_code": doc.name}))
    d["modified"] = str(doc.modified)
    return d


@frappe.whitelist()
def get(name):
    doc = frappe.get_doc("Item", name)
    doc.check_permission("read")
    return _pack(doc)


def _apply(doc, data, new):
    for f in ITEM_FIELDS:
        if f in data and not (f == "stock_uom" and not new and frappe.db.exists("Stock Ledger Entry", {"item_code": doc.name})):
            doc.set(f, data[f])
    for t, fs in CHILD_FIELDS.items():
        if t in data:
            doc.set(t, [])
            for r in data[t] or []:
                if any(r.get(f) not in (None, "") for f in fs):
                    doc.append(t, {f: r.get(f) for f in fs if f in r})
    if "item_defaults" in data:
        co = company()
        keep = [r.as_dict() for r in doc.item_defaults if r.company != co]
        doc.set("item_defaults", [])
        for r in keep:
            doc.append("item_defaults", {f: r.get(f) for f in DEFAULT_FIELDS})
        for r in data["item_defaults"] or []:
            row = {f: r.get(f) for f in DEFAULT_FIELDS if r.get(f)}
            row["company"] = co
            doc.append("item_defaults", row)
    if not any(r.uom == doc.stock_uom for r in doc.uoms):
        doc.append("uoms", {"uom": doc.stock_uom, "conversion_factor": 1})


def _set_price(item, rate):
    pl = _price_list()
    if not pl or rate in (None, ""):
        return
    rate = flt(rate)
    name = frappe.db.get_value("Item Price", {"item_code": item, "price_list": pl, "selling": 1}, "name")
    if name:
        if flt(frappe.db.get_value("Item Price", name, "price_list_rate")) != rate:
            frappe.db.set_value("Item Price", name, "price_list_rate", rate)
    elif rate:
        frappe.get_doc({"doctype": "Item Price", "item_code": item, "price_list": pl, "selling": 1, "price_list_rate": rate, "currency": frappe.get_cached_value("Company", company(), "default_currency")}).insert(ignore_permissions=True)


@frappe.whitelist()
def save(doc):
    data = frappe.parse_json(doc)
    new = not data.get("name")
    opening = flt(data.get("opening_stock")) if new else 0
    if new:
        frappe.has_permission("Item", "create", throw=True)
        d = frappe.new_doc("Item")
        d.item_code = (data.get("item_code") or "").strip()
        if frappe.db.get_single_value("Stock Settings", "item_naming_by") != "Naming Series" and not d.item_code:
            frappe.throw(_("Item Code is required"))
        if frappe.db.get_single_value("Stock Settings", "item_naming_by") == "Naming Series":
            d.item_code = ""
        if not data.get("item_name") and not d.item_code:
            frappe.throw(_("Item Name is required"))
        d.item_name = data.get("item_name") or d.item_code
        _apply(d, data, True)
        if opening and cint(d.is_stock_item) and not (flt(d.valuation_rate) or flt(data.get("standard_rate"))):
            frappe.throw(_("Valuation Rate is mandatory if Opening Stock is entered"))
        d.flags.ignore_mandatory = False
        d.insert()
    else:
        d = frappe.get_doc("Item", data["name"])
        d.check_permission("write")
        if data.get("modified") and str(d.modified) != str(data["modified"]):
            frappe.throw(_("This item was changed by someone else. Reload it and try again."), frappe.TimestampMismatchError)
        _apply(d, data, False)
        d.save()
    _set_price(d.name, data.get("standard_rate"))
    if opening and cint(d.is_stock_item):
        wh = next((r.default_warehouse for r in d.item_defaults if r.company == company() and r.default_warehouse), None) or settings().default_warehouse
        if not wh:
            frappe.throw(_("Pick a default warehouse for this item to post opening stock."))
        _opening_stock(d.name, wh, opening, flt(d.valuation_rate) or flt(data.get("standard_rate")))
    return _pack(frappe.get_doc("Item", d.name))


def _opening_stock(item, warehouse, qty, rate):
    from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

    with elevated():
        se = make_stock_entry(item_code=item, target=warehouse, qty=qty, rate=rate, company=company(), posting_date=nowdate(), posting_time=nowtime())
        se.add_comment("Comment", _("Opening Stock"))
    return se.name


@frappe.whitelist()
def adjust_stock(item_code, warehouse, qty, valuation_rate=None):
    frappe.get_doc("Item", item_code).check_permission("write")
    if warehouse not in _whs():
        frappe.throw(_("Warehouse {0} is not available here").format(warehouse))
    qty, rate = flt(qty), flt(valuation_rate)
    if qty < 0:
        frappe.throw(_("Quantity cannot be negative"))
    item = frappe.get_cached_doc("Item", item_code)
    if not item.is_stock_item:
        frappe.throw(_("{0} is not a stock item").format(item_code))
    if qty > 0 and not rate:
        rate = flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "valuation_rate")) or flt(item.valuation_rate)
        if not rate:
            frappe.throw(_("Valuation Rate is mandatory when the quantity is above zero."))
    co = company()
    with elevated():
        sr = frappe.new_doc("Stock Reconciliation")
        sr.company, sr.purpose, sr.posting_date = co, "Stock Reconciliation", nowdate()
        sr.expense_account = frappe.get_cached_value("Company", co, "stock_adjustment_account")
        sr.cost_center = frappe.get_cached_value("Company", co, "cost_center")
        sr.append("items", {"item_code": item_code, "warehouse": warehouse, "qty": qty, "valuation_rate": rate})
        sr.insert()
        sr.submit()
        sr.add_comment("Comment", _("Stock adjusted from Counter Desk by {0}").format(frappe.session.user))
    return {"name": sr.name, "stock": _stock(item_code, 1)}

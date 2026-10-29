"""Regression smoke: standard ERPNext Customer > Item > Sales Invoice > Payment Entry flow, run as Administrator.
Run before and after installing counter_desk; both runs must print the same result."""
import json
import frappe
from frappe.utils import nowdate

CO = "Counter Demo Co."
WH = "Main Store - CDC"
TPL = "VAT 15% - CDC"


def run():
    out = {}
    cust = frappe.db.get_value("Customer", {"customer_name": "CDSMOKE Customer"}, "name")
    if not cust:
        cust = frappe.get_doc({"doctype": "Customer", "customer_name": "CDSMOKE Customer", "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"), "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name")}).insert().name
    if not frappe.db.exists("Item", "CDSMOKE-ITEM"):
        frappe.get_doc({"doctype": "Item", "item_code": "CDSMOKE-ITEM", "item_name": "CDSMOKE Item", "item_group": "Accessories", "stock_uom": "Nos", "is_stock_item": 1, "opening_stock": 100, "valuation_rate": 5, "standard_rate": 10,
                        "item_defaults": [{"company": CO, "default_warehouse": WH}]}).insert()
    frappe.db.commit()
    before = frappe.db.get_value("Bin", {"item_code": "CDSMOKE-ITEM", "warehouse": WH}, "actual_qty") or 0
    si = frappe.get_doc({"doctype": "Sales Invoice", "customer": cust, "company": CO, "posting_date": nowdate(), "set_posting_time": 0, "update_stock": 1, "set_warehouse": WH,
                         "taxes_and_charges": TPL, "disable_rounded_total": 1, "items": [{"item_code": "CDSMOKE-ITEM", "qty": 2, "rate": 10}]})
    si.set_missing_values(); si.insert(); si.calculate_taxes_and_totals(); si.save(); si.submit()
    out["si_grand_total"] = si.grand_total
    out["si_status"] = frappe.db.get_value("Sales Invoice", si.name, "status")
    out["stock_after_si"] = (frappe.db.get_value("Bin", {"item_code": "CDSMOKE-ITEM", "warehouse": WH}, "actual_qty") or 0) - before
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    pe = get_payment_entry("Sales Invoice", si.name); pe.reference_no = "CDSMOKE"; pe.reference_date = nowdate(); pe.insert(); pe.submit()
    out["pe_paid"] = pe.paid_amount
    out["si_status_after_pe"] = frappe.db.get_value("Sales Invoice", si.name, "status")
    out["si_outstanding_after_pe"] = frappe.db.get_value("Sales Invoice", si.name, "outstanding_amount")
    pe.cancel(); si.reload()
    out["si_outstanding_after_pe_cancel"] = si.outstanding_amount
    si.cancel()
    out["stock_after_si_cancel"] = (frappe.db.get_value("Bin", {"item_code": "CDSMOKE-ITEM", "warehouse": WH}, "actual_qty") or 0) - before
    out["si_docstatus"] = frappe.db.get_value("Sales Invoice", si.name, "docstatus")
    for dt, n in (("Payment Entry", pe.name), ("Sales Invoice", si.name)):
        frappe.delete_doc(dt, n, force=1)
    return json.dumps(out, sort_keys=True)

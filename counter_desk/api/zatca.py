"""Retry sending an invoice to ZATCA through the installed zatca_erpgulf app. Only meaningful when the app is installed and the company has e-invoicing on."""
import frappe
from frappe import _

from counter_desk.api.common import elevated, zatca_enabled


@frappe.whitelist()
def retry(name):
    d = frappe.get_doc("Sales Invoice", name)
    d.check_permission("submit")
    if d.docstatus != 1:
        frappe.throw(_("Only submitted invoices can be sent to ZATCA."))
    if not zatca_enabled(d.company):
        frappe.throw(_("ZATCA e-invoicing is not enabled for {0}.").format(d.company))
    if (d.get("custom_zatca_status") or "") in ("REPORTED", "CLEARED"):
        frappe.throw(_("This invoice has already been accepted by ZATCA."))
    try:
        from zatca_erpgulf.zatca_erpgulf.sign_invoice import zatca_background_on_submit
    except ImportError:
        frappe.throw(_("The ZATCA app is not installed on this site."))
    with elevated():
        zatca_background_on_submit(d, "on_submit")
    return {"status": frappe.db.get_value("Sales Invoice", name, "custom_zatca_status")}

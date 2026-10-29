import frappe
from erpnext.stock.doctype.item.item import Item

from counter_desk.api.common import elevated


class CounterItem(Item):
    """ERPNext posts opening stock with the saving user's rights. Invoicing users have no Stock Entry rights, so for them
    the posting runs as the system, into the shop's default warehouse when the item has none. Everyone else behaves as before."""

    def set_opening_stock(self):
        if frappe.session.user == "Administrator" or frappe.has_permission("Stock Entry", "create"):
            return super().set_opening_stock()
        cfg = frappe.get_cached_doc("Counter Desk Settings")
        if not any(r.company == cfg.company and r.default_warehouse for r in self.item_defaults):
            self.append("item_defaults", {"company": cfg.company, "default_warehouse": cfg.default_warehouse})
        with elevated():
            return super().set_opening_stock()

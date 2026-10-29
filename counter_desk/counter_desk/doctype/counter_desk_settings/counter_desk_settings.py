import frappe
from frappe.model.document import Document


class CounterDeskSettings(Document):
    def validate(self):
        if self.default_warehouse and frappe.db.get_value("Warehouse", self.default_warehouse, "company") != self.company:
            frappe.throw(f"Warehouse {self.default_warehouse} does not belong to {self.company}")
        if self.default_tax_template and frappe.db.get_value("Sales Taxes and Charges Template", self.default_tax_template, "company") != self.company:
            frappe.throw(f"Tax template {self.default_tax_template} does not belong to {self.company}")

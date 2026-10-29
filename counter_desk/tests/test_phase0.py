import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import common
from counter_desk.setup.install import is_counter_only


class TestPhase0(FrappeTestCase):
    def tearDown(self):
        frappe.set_user("Administrator")

    def test_roles_and_perms(self):
        self.assertTrue(frappe.db.exists("Role", "Invoicing User"))
        for dt in ("Sales Invoice", "Payment Entry", "Item", "Customer"):
            self.assertTrue(frappe.db.exists("Custom DocPerm", {"parent": dt, "role": "Invoicing User", "read": 1}), dt)
        # cashier may not cancel; manager may
        self.assertFalse(frappe.db.get_value("Custom DocPerm", {"parent": "Sales Invoice", "role": "Invoicing User"}, "cancel"))
        self.assertTrue(frappe.db.get_value("Custom DocPerm", {"parent": "Sales Invoice", "role": "Invoicing Manager"}, "cancel"))
        # no stock or journal rights
        for dt in ("Stock Entry", "Journal Entry", "Purchase Invoice"):
            self.assertFalse(frappe.db.exists("Custom DocPerm", {"parent": dt, "role": "Invoicing User"}), dt)

    def test_is_counter_only(self):
        self.assertTrue(is_counter_only("cashier@counter.test"))
        self.assertFalse(is_counter_only("Administrator"))

    def test_boot(self):
        frappe.set_user("cashier@counter.test")
        b = common.boot()
        for k in ("company", "settings", "warehouses", "modes_of_payment", "tax_templates", "print_formats", "can", "zatca"):
            self.assertIn(k, b)
        self.assertEqual(b["company"]["name"], "Counter Demo Co.")
        self.assertTrue(b["can"]["Sales Invoice"]["submit"])
        self.assertFalse(b["can"]["Sales Invoice"]["cancel"])
        self.assertTrue(all(m["account"] for m in b["modes_of_payment"]))

    def test_link_search_allowlist(self):
        frappe.set_user("cashier@counter.test")
        self.assertTrue(common.link_search("Customer", "Walk"))
        with self.assertRaises(frappe.PermissionError):
            common.link_search("User", "a")

    def test_pin(self):
        frappe.set_user("cashier@counter.test")
        with self.assertRaises(frappe.PermissionError):
            common.check_pin_or_manager("0000")
        self.assertTrue(common.check_pin_or_manager("1234"))
        frappe.set_user("manager@counter.test")
        self.assertTrue(common.check_pin_or_manager(None))

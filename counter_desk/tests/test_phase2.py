import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import customer as api


def doc(**kw):
    d = {"customer_name": "CD Cust " + frappe.generate_hash(length=5), "customer_type": "Company", "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"), "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
         "tax_id": "311234567890003", "mobile_no": "+966 55 111 2222", "email_id": "cd@example.com", "address_line1": "Olaya St", "city": "Riyadh"}
    d.update(kw)
    return json.dumps(d)


class TestCustomers(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_create_with_contact_and_address(self):
        r = api.save(doc())
        self.assertEqual(r["tax_id"], "311234567890003")
        self.assertEqual(r["mobile_no"], "+966 55 111 2222")
        self.assertEqual(r["email_id"], "cd@example.com")
        self.assertEqual(r["address_line1"], "Olaya St")
        self.assertTrue(frappe.db.exists("Dynamic Link", {"link_doctype": "Customer", "link_name": r["name"], "parenttype": "Contact"}))
        self.assertTrue(frappe.db.exists("Dynamic Link", {"link_doctype": "Customer", "link_name": r["name"], "parenttype": "Address"}))

    def test_update_changes_same_contact(self):
        r = api.save(doc())
        con = frappe.db.get_value("Customer", r["name"], "customer_primary_contact")
        r["mobile_no"], r["city"] = "+966 50 000 1111", "Jeddah"
        r2 = api.save(json.dumps(r, default=str))
        self.assertEqual(r2["mobile_no"], "+966 50 000 1111")
        self.assertEqual(r2["city"], "Jeddah")
        self.assertEqual(frappe.db.get_value("Customer", r["name"], "customer_primary_contact"), con)

    def test_vat_number_rules(self):
        for bad in ("12345", "411234567890003", "31123456789000X"):
            with self.assertRaises(frappe.ValidationError):
                api.save(doc(tax_id=bad))
        self.assertEqual(api.save(doc(tax_id=""))["tax_id"], "")

    def test_name_required_and_search(self):
        with self.assertRaises(frappe.ValidationError):
            api.save(doc(customer_name=" "))
        r = api.save(doc(customer_name="Zed Searchable Trading"))
        self.assertEqual(api.list(txt="Searchable")["rows"][0]["name"], r["name"])
        self.assertIn(r["name"], [x["name"] for x in api.list(txt="311234567890003")["rows"]])

    def test_stale_edit(self):
        r = api.save(doc())
        frappe.db.sql("update `tabCustomer` set modified = DATE_ADD(modified, INTERVAL 1 SECOND) where name=%s", r["name"])
        with self.assertRaises(frappe.TimestampMismatchError):
            api.save(json.dumps(r, default=str))

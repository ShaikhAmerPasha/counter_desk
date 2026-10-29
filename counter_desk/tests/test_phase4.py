import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import invoice as iapi
from counter_desk.api import zatca as api
from counter_desk.tests.test_phase3 import _cust, _item


class TestZatca(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")

    def tearDown(self):
        frappe.set_user("Administrator")

    def submitted(self):
        d = iapi.new_doc(customer=_cust(), item=_item())
        d["items"][0]["qty"] = 1
        return iapi.submit(iapi.save(json.dumps(d, default=str))["name"])

    def test_disabled_company_hides_zatca(self):
        inv = self.submitted()
        self.assertFalse(iapi.zatca(inv["name"])["enabled"])
        self.assertNotIn("custom_zatca_status", inv)
        with self.assertRaises(frappe.ValidationError):
            api.retry(inv["name"])

    def test_enabled_company_exposes_status_and_retry_reaches_zatca_app(self):
        inv = self.submitted()
        frappe.db.set_value("Company", "Counter Demo Co.", "custom_zatca_invoice_enabled", 1)
        frappe.clear_cache()
        try:
            got = iapi.get(inv["name"])
            self.assertEqual(got["custom_zatca_status"], "Not Submitted")
            self.assertTrue(iapi.zatca(inv["name"])["enabled"])
            # the demo company is not onboarded, so the ZATCA app itself refuses, and that message reaches the caller
            with self.assertRaises(frappe.ValidationError):
                api.retry(inv["name"])
            frappe.db.set_value("Sales Invoice", inv["name"], "custom_zatca_status", "REPORTED")
            with self.assertRaises(frappe.ValidationError):
                api.retry(inv["name"])  # already accepted
            self.assertIn("ZATCA issues", iapi.list(tab="ZATCA issues")["counts"])
        finally:
            frappe.db.set_value("Company", "Counter Demo Co.", "custom_zatca_invoice_enabled", 0)
            frappe.clear_cache()

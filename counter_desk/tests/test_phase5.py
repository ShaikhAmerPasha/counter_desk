import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import invoice as iapi
from counter_desk.api import payment as api
from counter_desk.tests.test_phase3 import WH, _cust, _item


class TestPayments(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")
        self.item, self.cust = _item(), _cust()

    def tearDown(self):
        frappe.set_user("Administrator")

    def invoice(self, qty=2, **kw):
        d = iapi.new_doc(customer=self.cust, item=self.item)
        d["items"][0]["qty"] = qty
        d.update(kw)
        s = iapi.save(json.dumps(d, default=str))
        return iapi.submit(s["name"])

    def pay(self, pe):
        return api.save(json.dumps(pe, default=str))

    def test_pay_full_from_invoice(self):
        inv = self.invoice(2)
        pe = api.new_from_invoice(inv["name"])
        self.assertEqual((pe["paid_amount"], pe["party"], pe["references"][0]["allocated_amount"]), (23, self.cust, 23))
        s = self.pay(pe)
        self.assertEqual((s["docstatus"], s["status"]), (0, "Draft"))
        sub = api.submit(s["name"])
        self.assertEqual(sub["status"], "Submitted")
        row = frappe.db.get_value("Sales Invoice", inv["name"], ["status", "outstanding_amount"], as_dict=1)
        self.assertEqual((row.status, row.outstanding_amount), ("Paid", 0))
        self.assertEqual([p["name"] for p in iapi.get(inv["name"])["pay_hist"]], [s["name"]])

    def test_partial_then_rest(self):
        inv = self.invoice(2)
        pe = api.new_from_invoice(inv["name"])
        pe["paid_amount"], pe["references"][0]["allocated_amount"] = 10, 10
        api.submit(self.pay(pe)["name"])
        self.assertEqual(frappe.db.get_value("Sales Invoice", inv["name"], ["status", "outstanding_amount"]), ("Partly Paid", 13))
        pe2 = api.new_from_invoice(inv["name"])
        self.assertEqual(pe2["paid_amount"], 13)
        api.submit(self.pay(pe2)["name"])
        self.assertEqual(frappe.db.get_value("Sales Invoice", inv["name"], "status"), "Paid")

    def test_over_allocation_blocked(self):
        inv = self.invoice(1)
        pe = api.new_from_invoice(inv["name"])
        pe["paid_amount"], pe["references"][0]["allocated_amount"] = 50, 50
        with self.assertRaises(frappe.ValidationError):
            api.submit(self.pay(pe)["name"])

    def test_bank_needs_reference(self):
        inv = self.invoice(1)
        pe = api.new_from_invoice(inv["name"])
        pe["mode_of_payment"], pe["paid_to"] = "Credit Card", None
        with self.assertRaises(frappe.ValidationError):
            self.pay(pe)
        pe["reference_no"], pe["reference_date"] = "TRX-1", frappe.utils.nowdate()
        self.assertTrue(self.pay(pe)["name"])

    def test_get_outstanding_fifo_and_advance(self):
        a, b = self.invoice(1), self.invoice(2)
        r = api.get_outstanding(self.cust, 20)
        self.assertEqual([x["reference_name"] for x in r["references"]], [a["name"], b["name"]])
        self.assertEqual([x["allocated_amount"] for x in r["references"]], [11.5, 8.5])
        pe = api.new_doc(self.cust)
        pe.update({"paid_amount": 50, "references": api.get_outstanding(self.cust, 50)["references"]})
        s = api.submit(self.pay(pe)["name"])
        self.assertEqual(s["unallocated_amount"], 50 - 11.5 - 23)

    def test_cancel_needs_pin_and_restores_outstanding(self):
        inv = self.invoice(2)
        sub = api.submit(self.pay(api.new_from_invoice(inv["name"]))["name"])
        with self.assertRaises(frappe.PermissionError):
            api.cancel(sub["name"])
        c = api.cancel(sub["name"], "1234")
        self.assertEqual(c["docstatus"], 2)
        self.assertEqual(frappe.db.get_value("Sales Invoice", inv["name"], "outstanding_amount"), 23)

    def test_nothing_to_collect_and_listing(self):
        inv = self.invoice(1)
        sub = api.submit(self.pay(api.new_from_invoice(inv["name"]))["name"])
        with self.assertRaises(frappe.ValidationError):
            api.new_from_invoice(inv["name"])
        r = api.list(tab="Submitted", txt=sub["name"])
        self.assertEqual(r["rows"][0]["applied"], [inv["name"]])
        self.assertGreaterEqual(r["counts"]["Submitted"], 1)
        self.assertIn("html", api.print_html(name=sub["name"]))
        self.assertTrue(api.print_html(doc=json.dumps(api.new_from_invoice(self.invoice(1)["name"]), default=str))["html"])

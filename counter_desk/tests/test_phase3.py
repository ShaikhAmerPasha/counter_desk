import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import customer as capi
from counter_desk.api import invoice as api
from counter_desk.api import item as iapi

WH = "Main Store - CDC"


def _item(stock=50, rate=10, **kw):
    d = {"item_code": "CDI-" + frappe.generate_hash(length=6).upper(), "item_name": "CD Inv Item", "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"), "stock_uom": "Nos", "is_stock_item": 1, "valuation_rate": 4, "standard_rate": rate,
         "opening_stock": stock, "item_defaults": [{"company": "Counter Demo Co.", "default_warehouse": WH}], "uoms": [{"uom": "Nos", "conversion_factor": 1}]}
    d.update(kw)
    return iapi.save(json.dumps(d))["name"]


def _cust(**kw):
    d = {"customer_name": "CDI Cust " + frappe.generate_hash(length=5), "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"), "territory": frappe.db.get_value("Territory", {"is_group": 0}, "name")}
    d.update(kw)
    return capi.save(json.dumps(d))["name"]


class TestInvoices(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")
        self.item, self.cust = _item(), _cust()

    def tearDown(self):
        frappe.set_user("Administrator")

    def draft(self, qty=2, **kw):
        d = api.new_doc(customer=self.cust, item=self.item)
        d["items"][0]["qty"] = qty
        d.update(kw)
        return d

    def test_new_doc_defaults(self):
        d = api.new_doc()
        self.assertEqual(d["company"], "Counter Demo Co.")
        self.assertEqual(d["taxes_and_charges"], "VAT 15% - CDC")
        self.assertEqual(len(d["taxes"]), 1)
        self.assertEqual(d["disable_rounded_total"], 1)
        self.assertEqual(d["update_stock"], 1)
        self.assertEqual(d["grand_total"], 0)

    def test_item_details_from_erpnext(self):
        r = api.item_details(self.item, 3, None, self.cust, "Standard Selling", WH, None, 1)
        self.assertEqual(r["rate"], 10)
        self.assertEqual(r["warehouse"], WH)
        self.assertEqual(r["actual_qty"], 50)
        self.assertTrue(r["income_account"])

    def test_calculate_vat_and_discount(self):
        d = self.draft(2)
        c = api.calculate(json.dumps(d, default=str))
        self.assertEqual((c["total"], c["total_taxes_and_charges"], c["grand_total"]), (20, 3, 23))
        self.assertEqual(c["items"][0]["amount"], 20)
        d["additional_discount_percentage"] = 10
        c = api.calculate(json.dumps(d, default=str))
        self.assertEqual(c["discount_amount"], 2.3)
        self.assertEqual(c["grand_total"], 20.7)
        self.assertIn("only", c["in_words"].lower())

    def test_save_submit_stock_and_status(self):
        d = self.draft(2)
        s = api.save(json.dumps(d, default=str))
        self.assertEqual((s["docstatus"], s["status"], s["grand_total"]), (0, "Draft", 23))
        s["items"][0]["qty"] = 5
        s2 = api.save(json.dumps(s, default=str))
        self.assertEqual(s2["grand_total"], 57.5)
        sub = api.submit(s2["name"])
        self.assertEqual((sub["docstatus"], sub["status"], sub["outstanding_amount"]), (1, "Unpaid", 57.5))
        self.assertEqual(frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": WH}, "actual_qty"), 45)
        with self.assertRaises(frappe.ValidationError):
            api.save(json.dumps(sub, default=str))

    def test_stock_shortage_blocks_submit(self):
        d = self.draft(500)
        s = api.save(json.dumps(d, default=str))
        with self.assertRaises(frappe.ValidationError):
            api.submit(s["name"])

    def test_pos_payment_and_change(self):
        d = self.draft(2, is_pos=1)
        d["payments"] = [{"mode_of_payment": "Cash", "amount": 30}]
        c = api.calculate(json.dumps(d, default=str))
        self.assertEqual((c["paid_amount"], c["change_amount"], c["outstanding_amount"]), (30, 7, 0))
        s = api.save(json.dumps(d, default=str))
        sub = api.submit(s["name"])
        self.assertEqual(sub["status"], "Paid")
        self.assertEqual(sub["payments"][0]["type"], "Cash")

    def test_payment_terms_set_due_date(self):
        d = self.draft(1, payment_terms_template="Net 30")
        c = api.calculate(json.dumps(d, default=str))
        self.assertEqual(len(c["payment_schedule"]), 1)
        self.assertEqual(str(c["due_date"]), str(frappe.utils.add_days(frappe.utils.nowdate(), 30)))

    def test_cancel_needs_pin_and_restores_stock(self):
        s = api.save(json.dumps(self.draft(2), default=str))
        api.submit(s["name"])
        with self.assertRaises(frappe.PermissionError):
            api.cancel(s["name"])
        with self.assertRaises(frappe.PermissionError):
            api.cancel(s["name"], "0000")
        c = api.cancel(s["name"], "1234")
        self.assertEqual((c["docstatus"], c["status"]), (2, "Cancelled"))
        self.assertEqual(frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": WH}, "actual_qty"), 50)

    def test_return_flow(self):
        s = api.save(json.dumps(self.draft(4), default=str))
        api.submit(s["name"])
        with self.assertRaises(frappe.PermissionError):
            api.make_return(s["name"], "bad")
        r = api.make_return(s["name"], "1234")
        self.assertEqual((r["is_return"], r["return_against"]), (1, s["name"]))
        self.assertEqual(r["items"][0]["qty"], -4)
        r["items"][0]["qty"] = -1
        rs = api.save(json.dumps(r, default=str))
        rsub = api.submit(rs["name"])
        self.assertEqual(rsub["status"], "Return")
        # ERPNext default: the credit note carries its own negative balance and the original keeps its outstanding
        self.assertEqual(frappe.db.get_value("Sales Invoice", rs["name"], "outstanding_amount"), -11.5)
        self.assertEqual(frappe.db.get_value("Sales Invoice", s["name"], "outstanding_amount"), 46)
        self.assertEqual(frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": WH}, "actual_qty"), 47)

    def test_delete_only_draft(self):
        s = api.save(json.dumps(self.draft(1), default=str))
        self.assertTrue(api.delete(s["name"]))
        s2 = api.save(json.dumps(self.draft(1), default=str))
        api.submit(s2["name"])
        with self.assertRaises(frappe.ValidationError):
            api.delete(s2["name"])

    def test_list_counts_kpis_print(self):
        s = api.save(json.dumps(self.draft(1), default=str))
        r = api.list(tab="Draft", txt=s["name"])
        self.assertEqual([x["name"] for x in r["rows"]], [s["name"]])
        self.assertGreaterEqual(r["counts"]["Draft"], 1)
        self.assertIn("aging", r["kpis"])
        h = api.print_html(name=s["name"])
        self.assertIn("<html", h["html"].lower())
        self.assertTrue(api.print_html(doc=json.dumps(self.draft(1), default=str))["html"])

    def test_cashier_without_customer_or_items(self):
        with self.assertRaises(frappe.ValidationError):
            api.save(json.dumps(api.new_doc(), default=str))

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import item as api


def doc(**kw):
    bc = "CDT" + frappe.generate_hash(length=8).upper()
    d = {"item_code": "CDT-" + frappe.generate_hash(length=6).upper(), "item_name": "CD Test Item", "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"), "stock_uom": "Nos", "is_stock_item": 1, "valuation_rate": 5, "standard_rate": 9.5, "opening_stock": 12,
         "barcodes": [{"barcode": bc, "barcode_type": ""}], "uoms": [{"uom": "Nos", "conversion_factor": 1}],
         "item_defaults": [{"company": "Counter Demo Co.", "default_warehouse": "Main Store - CDC"}], "reorder_levels": [{"warehouse": "Main Store - CDC", "warehouse_reorder_level": 5, "warehouse_reorder_qty": 20, "material_request_type": "Purchase"}]}
    d.update(kw)
    return json.dumps(d)


class TestItems(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_create_with_opening_stock_price_barcode(self):
        r = api.save(doc())
        self.assertTrue(r["name"])
        self.assertEqual(r["standard_rate"], 9.5)
        self.assertEqual(sum(b["actual_qty"] for b in r["stock"]["bins"]), 12)
        self.assertTrue(r["barcodes"][0]["barcode"].startswith("CDT"))
        self.assertEqual(r["reorder_levels"][0]["warehouse_reorder_level"], 5)
        # stock entry was posted by the system, owned by Administrator context, and the item by the cashier
        self.assertEqual(frappe.db.get_value("Item", r["name"], "owner"), "cashier@counter.test")
        self.assertTrue(frappe.db.exists("Stock Ledger Entry", {"item_code": r["name"], "actual_qty": 12}))

    def test_opening_stock_needs_valuation(self):
        with self.assertRaises(frappe.ValidationError):
            api.save(doc(valuation_rate=0, standard_rate=0))

    def test_duplicate_barcode(self):
        r = api.save(doc())
        with self.assertRaises(frappe.ValidationError):
            api.save(doc(item_name="CD Test Item 2", barcodes=[{"barcode": r["barcodes"][0]["barcode"]}]))

    def test_update_price_and_fields(self):
        r = api.save(doc(opening_stock=0))
        r["item_name"], r["standard_rate"], r["max_discount"] = "Renamed", 11, 7
        r2 = api.save(json.dumps(r, default=str))
        self.assertEqual((r2["item_name"], r2["standard_rate"], r2["max_discount"]), ("Renamed", 11, 7))

    def test_stale_edit_rejected(self):
        r = api.save(doc(opening_stock=0))
        frappe.db.set_value("Item", r["name"], "description", "changed elsewhere")
        frappe.db.sql("update `tabItem` set modified = DATE_ADD(modified, INTERVAL 1 SECOND) where name=%s", r["name"])
        with self.assertRaises(frappe.TimestampMismatchError):
            api.save(json.dumps(r, default=str))

    def test_list_filters_and_search(self):
        r = api.save(doc(opening_stock=0))
        by_code = api.list(txt=r["name"])
        self.assertEqual([x["name"] for x in by_code["rows"]], [r["name"]])
        by_barcode = api.list(txt=r["barcodes"][0]["barcode"])
        self.assertEqual(by_barcode["rows"][0]["name"], r["name"])
        low = api.list(txt=r["name"], stock="Low / out of stock")
        self.assertEqual(len(low["rows"]), 1)
        self.assertEqual(api.list(txt=r["name"], stock="In stock")["rows"], [])

    def test_adjust_stock(self):
        r = api.save(doc())
        out = api.adjust_stock(r["name"], "Main Store - CDC", 30, 6)
        self.assertEqual(next(b["actual_qty"] for b in out["stock"]["bins"] if b["warehouse"] == "Main Store - CDC"), 30)
        out = api.adjust_stock(r["name"], "Main Store - CDC", 0)
        self.assertEqual(next(b["actual_qty"] for b in out["stock"]["bins"] if b["warehouse"] == "Main Store - CDC"), 0)
        with self.assertRaises(frappe.ValidationError):
            api.adjust_stock(r["name"], "Stores - TACH", 1, 1)

    def test_cashier_cannot_use_stock_doctypes_directly(self):
        self.assertFalse(frappe.has_permission("Stock Entry", "create"))
        self.assertFalse(frappe.has_permission("Stock Reconciliation", "create"))
        self.assertFalse(frappe.has_permission("Item", "delete"))


class TestDeskOpeningStock(FrappeTestCase):
    """Saving an item through the standard desk document as an invoicing user must still post opening stock."""

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_invoicing_user_opening_stock_via_standard_doc(self):
        frappe.set_user("cashier@counter.test")
        code = "CDD-" + frappe.generate_hash(length=6).upper()
        d = frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": code, "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"), "stock_uom": "Nos", "is_stock_item": 1, "opening_stock": 5, "valuation_rate": 20, "standard_rate": 45}).insert()
        qty = frappe.db.get_value("Bin", {"item_code": d.name, "warehouse": "Main Store - CDC"}, "actual_qty")
        self.assertEqual(qty, 5)
        self.assertFalse(frappe.has_permission("Stock Entry", "create"))

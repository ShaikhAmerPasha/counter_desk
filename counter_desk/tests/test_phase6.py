import base64
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from counter_desk.api import invoice as iapi
from counter_desk.tests.test_phase3 import _cust, _item
from counter_desk.utils.zatca_qr import invoice_qr, tlv_base64


def _decode(b64):
    raw, out, i = base64.b64decode(b64), {}, 0
    while i < len(raw):
        tag, ln = raw[i], raw[i + 1]
        out[tag] = raw[i + 2:i + 2 + ln].decode()
        i += 2 + ln
    return out


class TestZatcaPrint(FrappeTestCase):
    def setUp(self):
        frappe.set_user("cashier@counter.test")
        d = iapi.new_doc(customer=_cust(), item=_item())
        d["items"][0]["qty"] = 2
        self.inv = iapi.save(json.dumps(d, default=str))

    def tearDown(self):
        frappe.set_user("Administrator")

    def test_print_format_installed(self):
        self.assertEqual(frappe.db.get_value("Print Format", "Counter Desk Tax Invoice", ["doc_type", "custom_format", "disabled"]), ("Sales Invoice", 1, 0))

    def test_tlv_payload_has_the_five_zatca_fields(self):
        doc = frappe.get_doc("Sales Invoice", self.inv["name"])
        f = _decode(tlv_base64(doc))
        self.assertEqual(sorted(f), [1, 2, 3, 4, 5])
        self.assertEqual(f[4], "23.00")  # total with VAT
        self.assertEqual(f[5], "3.00")  # VAT
        self.assertRegex(f[3], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_qr_uses_zatca_image_when_present_else_sample(self):
        doc = frappe.get_doc("Sales Invoice", self.inv["name"])
        self.assertEqual(invoice_qr(doc)["source"], "sample")
        self.assertTrue(invoice_qr(doc)["src"].startswith("data:image/png;base64,"))
        doc.ksa_einv_qr = "/files/zatca_qr.png"
        self.assertEqual(invoice_qr(doc), {"src": "/files/zatca_qr.png", "payload": tlv_base64(doc), "source": "zatca"})

    def test_printed_invoice_shows_qr_and_vat(self):
        html = frappe.get_print("Sales Invoice", self.inv["name"], "Counter Desk Tax Invoice", no_letterhead=1)
        for needle in ("data:image/png;base64", "ZATCA QR", "TAX INVOICE", "فاتورة ضريبية", "23.00", self.inv["name"]):
            self.assertIn(needle, html)

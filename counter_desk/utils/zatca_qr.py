"""QR code for the printed invoice, in the ZATCA Phase 1 format (TLV fields, Base64, then QR).
When the ZATCA app has already produced its own QR image for the invoice, that image is used.
Otherwise a QR with the same payload is generated from the invoice data, so the printout looks the same either way."""
import base64

import frappe
import pyqrcode

SAMPLE_VAT = "000000000000000"


def _field(v):
    b = str(v or "").encode("utf-8")
    return b


def tlv_base64(doc):
    co = frappe.get_cached_doc("Company", doc.company)
    seller = co.get("custom__company_name_in_arabic__") or co.company_name
    vat_no = co.tax_id or SAMPLE_VAT
    stamp = f"{doc.posting_date}T{str(doc.posting_time or '00:00:00').split('.')[0]}Z"
    values = [seller, vat_no, stamp, f"{abs(doc.grand_total or 0):.2f}", f"{abs(doc.total_taxes_and_charges or 0):.2f}"]
    out = bytearray()
    for tag, v in enumerate(values, start=1):
        b = _field(v)
        out += bytes([tag, len(b)]) + b
    return base64.b64encode(bytes(out)).decode()


def _data_uri(text, scale=4):
    return "data:image/png;base64," + pyqrcode.create(text, error="M").png_as_base64_str(scale=scale, quiet_zone=1)


def invoice_qr(doc):
    """Jinja helper: returns {"src": image source, "payload": Base64 TLV, "source": "zatca" | "sample"}."""
    payload = tlv_base64(doc)
    app_qr = doc.get("ksa_einv_qr")
    if app_qr:
        return {"src": app_qr, "payload": payload, "source": "zatca"}
    return {"src": _data_uri(payload), "payload": payload, "source": "sample"}

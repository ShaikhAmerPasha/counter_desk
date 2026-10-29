import frappe


def execute():
    """Sites that installed the first build carry the old role names; rename keeps users and permissions attached."""
    for old, new in (("Counter User", "Invoicing User"), ("Counter Manager", "Invoicing Manager")):
        if frappe.db.exists("Role", old) and not frappe.db.exists("Role", new):
            frappe.rename_doc("Role", old, new, force=True)

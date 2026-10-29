import frappe

from counter_desk.setup.install import apply_user_defaults, is_counter_only


def on_session_creation(login_manager=None):
    """Counter-only users land on the counter app, everyone else keeps the normal home page."""
    if frappe.session.user != "Guest" and is_counter_only(frappe.session.user):
        frappe.local.response["home_page"] = "/app/invoicing"
        apply_user_defaults(frappe.session.user)  # keeps the shop defaults in place even if someone cleared them

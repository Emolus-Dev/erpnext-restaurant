# -*- coding: utf-8 -*-
# Copyright (c) 2021, Quantum Bit Core and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import hashlib
import json

import frappe

from frappe import _


@frappe.whitelist()
def call(model, name, method, args=None):
    doc = frappe.get_doc(model, name)
    if args is not None:
        _args = json.loads(args)
        # args = [_args[arg] for arg in _args]
        kwargs = {arg: _args[arg] for arg in _args}
        return getattr(doc, method)(**kwargs)
    # return doc.run_method(method, **kwargs)
    else:
        return getattr(doc, method)


def encrypt(data, method):
    if not isinstance(data, bytes):
        data = data.encode("utf-8")

    if method == "md5":
        return hashlib.md5(data).hexdigest()
    if method == "sha1":
        return hashlib.sha1(data).hexdigest()
    if method == "sha224":
        return hashlib.sha3_224(data).hexdigest()


@frappe.whitelist()
def validate_link():
    """validate link when updated by user"""
    import frappe
    import frappe.utils

    value, options, fetch = (
        frappe.form_dict.get("value"),
        frappe.form_dict.get("options"),
        frappe.form_dict.get("fetch"),
    )

    # no options, don't validate
    if not options or options == "null" or options == "undefined":
        frappe.response["message"] = "Ok"
        return

    valid_value = frappe.db.get_all(options, filters=dict(name=value), as_list=1, limit=1)

    if valid_value:
        valid_value = valid_value[0][0]

        # get fetch values
        if fetch:
            # escape with "`"
            fetch = ", ".join(("`{0}`".format(f.strip()) for f in fetch.split(",")))
            fetch_value = None
            try:
                fetch_value = frappe.db.sql("select %s from `tab%s` where name=%s" % (fetch, options, "%s"), (value,))[
                    0
                ]
            except Exception as e:
                error_message = str(e).split("Unknown column '")
                fieldname = None if len(error_message) <= 1 else error_message[1].split("'")[0]
                frappe.msgprint(
                    _("Wrong fieldname <b>{0}</b> in add_fetch configuration of custom client script").format(fieldname)
                )
                frappe.errprint(frappe.get_traceback())

            if fetch_value:
                frappe.response["fetch_values"] = [frappe.utils.parse_val(c) for c in fetch_value]

        frappe.response["valid_value"] = valid_value
        frappe.response["message"] = "Ok"


@frappe.whitelist()
def new_items_in_order(doc, event):
    pass


@frappe.whitelist()
def change_order_item_to_sent(item_name):
    order_item = frappe.get_doc("Order Entry Item", item_name)
    order_item.status = "Completed"
    order_item.save()


@frappe.whitelist()
def get_menu_items(item_group):
    return frappe.db.get_all("Item", filters={"item_group": item_group}, fields=["name", "item_name", "item_group"])


@frappe.whitelist()
def get_product_bundle_choices(item_code: str):
    try:
        filters = {
            "disabled": 0,
            "new_item_code": item_code,
            "custom_max_choices": [">=", 2],
        }

        docs = frappe.get_all("Product Bundle", filters=filters, fields=["name"])

        if docs:
            doc = frappe.get_doc("Product Bundle", docs[0].name)
            if doc and len(doc.custom_choices) > 0:
                choices_with_image = []
                for choice in doc.custom_choices:
                    choice_dict = choice.as_dict()

                    image_url = frappe.get_value("Item", choice.item_code, "image")
                    choice_dict["item_image"] = image_url if image_url else None
                    choices_with_image.append(choice_dict)

                return choices_with_image

    except frappe.DoesNotExistError:
        frappe.log_error(
            "get_product_bundle_choices",
            f"Product Bundle Settings not found for filters: {filters}",
        )

    return []


@frappe.whitelist()
def validate_max_choices(item_code: str, max_choices: int, qty_items: int):
    try:
        filters = {
            "disabled": 0,
            "new_item_code": item_code,
            "custom_max_choices": [">=", 2],
        }

        docs = frappe.get_all("Product Bundle", filters=filters, fields=["name"])

        if docs:
            doc = frappe.get_doc("Product Bundle", docs[0].name)
            if doc and len(doc.custom_choices) > 0:
                total_allowed_choices = doc.custom_max_choices * int(qty_items)

                if int(max_choices) > total_allowed_choices:
                    return {
                        "status": "error",
                        "message": f"El número máximo de opciones para cada {item_code} permitidas es {doc.custom_max_choices} ",
                    }
                else:
                    return {
                        "status": "success",
                        "message": f"Selección válida. Has elegido {max_choices} de {total_allowed_choices} opciones permitidas",
                    }

    except frappe.DoesNotExistError:
        frappe.log_error(
            "validate_max_choices",
            f"Product Bundle Settings not found for filters: {filters}",
        )

    return {
        "status": "error",
        "message": "No se encontró la configuración de Product Bundle",
    }

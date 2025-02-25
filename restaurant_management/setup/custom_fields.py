from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def insert_custom_fields():
    try:
        custom_fields = {
            "User": [
                dict(
                    fieldname="restaurant_pin",
                    label="Restaurant PIN",
                    fieldtype="Password",
                    insert_after="reset_password_key",
                    read_only=0,
                    print_hide=1,
                ),
            ],
        }

        create_custom_fields(custom_fields)
        print("Restaurant PIN creado correctamente")

    except Exception:
        print("Restaurant PIN ya existian, se omite este parche")

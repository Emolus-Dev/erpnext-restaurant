def get_assets():
    return [
        "/assets/restaurant_management/js/clusterize.min.js",
        "/assets/restaurant_management/js/interact.min.js",
        "/assets/restaurant_management/js/drag.js",
        "/assets/restaurant_management/js/RM.helper.js",
        "/assets/restaurant_management/js/object-manage.js",
        "/assets/restaurant_management/helper/js/jshtml-class.js",
        "/assets/restaurant_management/helper/js/num-pad-class.js",
        "/assets/restaurant_management/helper/js/desk-modal.js",
        "/assets/restaurant_management/helper/js/frappe-helper-api.js",
        "/assets/restaurant_management/helper/js/frappe-form-class.js",
        "/assets/restaurant_management/helper/js/desk-form-class.js",
    ]


def get_custom_fields():
    fixtures_fillup = []

    custom_fields_list = [
        "Product Bundle-custom_choices",
        "Product Bundle-custom_max_choices",
        "Product Bundle-custom_column_break_32acx",
    ]

    custom_field = {
        "dt": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                custom_fields_list,
            ]
        ],
    }

    fixtures_fillup.append(custom_field)

    return fixtures_fillup

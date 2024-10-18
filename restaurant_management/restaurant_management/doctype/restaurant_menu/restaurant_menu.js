// Copyright (c) 2024, Quantum Bit Core and contributors
// For license information, please see license.txt

frappe.ui.form.on('Restaurant Menu', {
  // refresh(frm) {},
  setup(frm) {
    frm.set_query('item_group', () => {
      return {
        filters: {
          is_group: 0,
        },
      };
    });
  },
  async get_items(frm) {
    if (!frm.doc.item_group) {
      return;
    }

    // let item_list = await frappe.db.get_list('Item', {
    //   fields: ['name', 'item_name', 'item_group'],
    //   filters: {
    //     item_group: frm.doc.item_group,
    //   },
    // });

    frappe.call({
      method: 'restaurant_management.api.get_menu_items',
      args: {
        item_group: frm.doc.item_group,
      },
      // disable the button until the request is completed
      // btn: $('.primary-action'),
      // freeze the screen until the request is completed
      freeze: true,
      callback: (r) => {
        let item_list = r.message;

        // on success
        console.log('item_list', frm.doc.item_group);

        item_list.forEach((item) => {
          const existingItem = frm.doc.menu_items.find((menuItem) => menuItem.item === item.name);
          console.log('item', item);
          if (!existingItem) {
            console.log('item', item);
            frm.add_child('menu_items', {
              item: item.name,
              item_name: item.item_name,
              item_group: item.item_group,
            });
          }
        });

        frm.refresh_field('menu_items');
      },
      error: (r) => {
        // on error
      },
    });
  },
});

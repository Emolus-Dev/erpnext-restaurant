// Copyright (c) 2024, Quantum Bit Core and contributors
// For license information, please see license.txt

frappe.ui.form.on('Restaurant Menu', {
  // refresh(frm) {},
  async get_items(frm) {
    if (!frm.doc.item_group) {
      return;
    }

    let item_list = await frappe.db.get_list('Item', {
      fields: ['name', 'item_name', 'item_group'],
      filters: {
        item_group: frm.doc.item_group,
      },
    });

    item_list.forEach((item) => {
      const existingItem = frm.doc.menu_items.find((menuItem) => menuItem.item === item.name);

      if (!existingItem) {
        frm.add_child('menu_items', {
          item: item.name,
          item_name: item.item_name,
          item_group: item.item_group,
        });
      }
    });

    frm.refresh_field('menu_items');
  },
});

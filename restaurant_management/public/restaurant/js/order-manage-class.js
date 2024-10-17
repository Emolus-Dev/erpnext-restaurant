class OrderManage extends ObjectManage {
  #objects = {};
  #components = {};
  #items = {};
  #numpad = null;
  current_layout = 'items';

  constructor(options) {
    super(options);

    this.modal = null;
    this.print_modal = null;
    this.current_order = null;
    this.transferring_order = false;
    this.table_name = this.table.data.name;
    this.order_container_name = `order-container-${this.table_name}`;
    this.order_entry_container_name = `container-order-entry-${this.table_name}`;
    this.editor_container_name = `edit-container-${this.table_name}`;
    this.pad_container_name = `pad-container-${this.table_name}`;
    this.item_container_name = `items-container-${this.table_name}`;
    this.invoice_container_name = `invoice-container-${this.table_name}`;
    this.not_selected_order = null;
    this.init_synchronize();
    this.initialize();
  }

  //get invoice_wrapper() { return document.getElementById(this.invoice_container_name);}
  get objects() {
    return this.#objects;
  }
  get components() {
    return this.#components;
  }
  get items() {
    return this.#items;
  }
  get orders() {
    return super.children;
  }
  get numpad() {
    return this.#numpad;
  }

  get container() {
    return document.getElementById(this.identifier);
  }
  get order_container() {
    return document.getElementById(this.order_container_name);
  }
  get order_entry_container() {
    return document.getElementById(this.order_entry_container_name);
  }

  init_synchronize() {
    frappe.realtime.on('pos_profile_update', () => {
      setTimeout(() => {
        this.check_buttons_status();
      }, 0);
    });
  }

  reload() {
    if (!this.is_enabled_to_open()) return;
    this.modal.load_data();
    this.make_reservation();
  }

  remove() {
    this.close();
    this.modal.remove();
  }

  initialize() {
    if (!this.is_enabled_to_open()) return;

    this.title = `${this.table.room.data.description} (${this.table.data.description}) ${this.table.data.customer}`;
    this.modal = RMHelper.default_full_modal(this.title, () => {
      this.make();
    });
  }

  set_title() {
    this.title = `${this.table.room.data.description} (${this.table.data.description}) ${
      this.table.data.customer || ''
    }`;
  }

  is_enabled_to_open() {
    if (!RM.can_open_order_manage(this.table)) {
      this.close();
      return false;
    }
    return true;
  }

  get_order_by_customer(customer) {
    let order = null;
    this.orders.forEach((o) => {
      if (o.data.customer == customer) {
        order = o;
      }
    });
    return order;
  }

  show() {
    if (!this.is_enabled_to_open()) return;

    if (RM.crm_customer) {
      this.get_orders();
      this.modal.show();
    } else {
      this.modal.show();
    }
    //if(RM.crm_customer){

    if (this.transferring_order) {
      if (this.current_order != null) {
        //**To move windows over the current, on transferring order**//
        this.current_order.edit_form = null;
        this.current_order.divide_account_modal = null;
        this.current_order.pay_form = null;
      }
      this.transferring_order = false;
    }

    this.make_reservation();
  }

  close() {
    this.modal.hide();
  }

  make() {
    this.make_dom();

    setTimeout(() => {
      this.get_orders();
      this.make_items();
      this.make_edit_input();
      this.make_pad();

      if (this.transferring_order && this.current_order != null) {
        this.current_order.edit_form = null;
        this.current_order.divide_account_modal = null;
        this.current_order.pay_form = null;
        this.transferring_order = null;
      }
    }, 100);
  }

  is_open() {
    return this.modal.modal.display;
  }

  make_dom() {
    this.empty_carts = frappe.jshtml({
      tag: 'div',
      content: RMHelper.no_data('No added items'),
      properties: {
        class: 'empty-carts',
        /*style: 'display: none'*/
      },
    });

    this.not_selected_order = frappe.jshtml({
      tag: 'div',
      properties: { class: 'no-order-message' },
      content: RMHelper.no_data('Select or create an Order'),
    });

    this.modal.container.append(this.template());
    this.#components.customer = RMHelper.default_button('Customer', 'people', () =>
      this.update_current_order('customer')
    );
    this.#components.dinners = RMHelper.default_button('Dinners', 'peoples', () =>
      this.update_current_order('dinners')
    );
    this.#components.delete = RMHelper.default_button(
      'Delete',
      'trash',
      () => this.delete_current_order(),
      DOUBLE_CLICK
    );

    this.modal.title_container.empty().append(RMHelper.return_main_button(this.title, () => this.modal.hide()).html());

    this.modal.buttons_container.prepend(`
			${this.components.delete.html()}
      ${this.components.customer.html()}
			${this.components.dinners.html()}
		`);

    this.make_reservation();

    RM.onResize(() => this.resize());

    setTimeout(() => {
      this.empty_carts.show();

      if (this.customer_editor) {
        this.customer_editor.reload();
      } else {
        this.customer_editor = new DeskForm({
          form_name: `Table Customer`,
          doc_name: this.table.data.name,
          location: this.customer_wrapper.JQ(),
          on_save: () => {
            this.table.data.customer = this.customer_editor.doc.customer;
            this.set_title();
            this.modal.title_container
              .empty()
              .append(RMHelper.return_main_button(this.title, () => this.modal.hide()).html());
          },
          primary_action_label: 'Save',
          after_load: () => {
            this.customer_editor.on('customer', 'change', () => {
              this.customer_editor.save();
            });
          },
        });
      }
    }, 0);
  }

  make_reservation() {
    setTimeout(() => {
      Reservation.render(this.table.data.name, this.reservation_wrapper.JQ());
    }, 0);
  }

  template() {
    const self = this;
    this.invoice_wrapper = frappe.jshtml({
      tag: 'div',
      properties: {
        id: this.invoice_container_name,
        class: 'product-list',
        style: 'height: 100%; overflow-y: auto;',
      },
    });

    this.items_wrapper = frappe.jshtml({
      tag: 'div',
      properties: {
        id: this.item_container_name,
        class: 'product-list',
        style: 'position: relative; height: calc(100% - 80px); overflow: auto;',
        //style: "height: calc(100% - 30px); overflow-y: auto;"
      },
    });

    this.item_type_wrapper = frappe.jshtml({
      tag: 'div',
      properties: {
        class: 'item-type-wrapper',
        /*style: "overflow-y: auto; display: flex;"*/
      },
    });

    this.item_parent_wrapper = frappe.jshtml({
      tag: 'div',
      properties: {
        style: 'overflow-y: auto; display: flex; padding: 2px;',
      },
    });

    this.reservation_wrapper = frappe.jshtml({
      tag: 'div',
    });

    this.customer_wrapper = frappe.jshtml({
      tag: 'div',
      properties: {
        class: 'col-md-12',
      },
    });

    const template = $(`
    <style>
      .item-action .tab-label {
        display: unset;
      }

      .order-manage.mob .tab {
        flex-direction: column;
        height: 100%;
        display: none !important;
        position: relative;
      }

      .order-manage.mob.sm .item-action .tab-label {
        display: none !important;
      }

      .order-manage.desk .tab {
        flex-direction: column;
        height: 100%;
        position: relative;
      }

      .order-manage.mob .tab.active {
        display: block !important;
      }

      .order-manage .table {
        margin: 0;
      }

      .order-manage.desk .tab {
        display: block !important;
      }

      .order-manage.desk .tab.options {
        display: none !important;
      }

      .order-manage.desk .tab.items-cart {
        height: 100%;
        right: 0;
        width: 400px;
        position: absolute;
      }

      .order-manage.desk .tab.items {
        right: 400px;
        width: calc(100% - 490px);
        position: absolute;
        border-left: var(--default-line);
        border-right: var(--default-line);
      }

      .order-manage.desk .footer-container {
        display: none;
      }

      .order-manage.desk .tab.orders {
        position: absolute;
        width: 90px;
        padding: 5px;
      }

      .item-type-wrapper {
        padding: 2px;
        /*background: var(--dark);*/
      }

      .item-type:hover {
        background: var(--dark);
        color: var(--light);
      }

      .item-type:focus {
        border: none !important;
        box-shadow: none !important;
      }
    </style>
		<div class="order-manage desk" id="${this.identifier}">
      <div class="content-container" style="height:calc(100% - 40px);">
          <div class="tab orders order-container" id="${this.order_container_name}">

          </div>
          <div class="tab options">
            <div class="options-container">
              <div class="customer-container">
                <div class="customer-wrapper">
                </div>
              </div>
                <div class="customer-container">
                  ${this.customer_wrapper.html()}
              </div>
              <div class="reservation-container">
                  ${this.reservation_wrapper.html()}
              </div>
            </div>
          </div>
          <div class="tab items">
              ${this.item_type_wrapper.html()}
              ${this.item_parent_wrapper.html()}
              ${this.items_wrapper.html()}
          </div>
          <div class="tab items-cart">
            <div class="panel-order-items" style="height: calc(100% - 400px); position: relative; width: 100%;overflow:auto;")>
              <ul class="products-list" id="${this.order_entry_container_name}">

              </ul>
              ${this.empty_carts.html()}
              ${this.not_selected_order.html()}
            </div>
            <table class="table no-border table-condensed panel-order-edit" style="position: absolute; bottom: 265px" id ="${
              this.editor_container_name
            }">

            </table>
            <table class="table no-border order-manage-control-buttons pad-container" style="position: absolute; bottom: 0" id="${
              this.pad_container_name
            }">

            </table>
          </div>
      </div>
      <footer class="footer-container" style="padding:5px; position: absolute;">
        <div class="footer-buttons">
          <button class="btn btn-default btn-flat options-action item-action" data-tab="options">
            <span class="fa fa-cog"></span> <span class="tab-label">${__('Options')}</span>
          </button>
          <button class="btn btn-default btn-flat orders-action item-action" data-tab="orders">
            <span class="fa fa-cutlery"></span> <span class="tab-label">${__('Orders')}</span>
          </button>
          <button class="btn btn-default btn-flat items-action item-action" data-tab="items">
            <span class="fa fa-cubes"></span> <span class="tab-label">${__('Items')}</span>
          </button>
          <button class="btn btn-default btn-flat items-cart-action item-action" data-tab="items-cart">
            <span class="fa fa-shopping-cart"></span> <span class="tab-label">${__('Cart')}</span>
            <span class="badge badge-pill badge-primary cart-count">0</span>
          </button>
        </div>
      </footer>
		</div>`);

    this.item_cart = template.find('.item-cart');
    this.cart_count = template.find('.cart-count');

    template.find('.item-action').each(function () {
      const tab = $(this).data('tab');
      self['tab-button' + tab] = $(this);
      self['tab-container' + tab] = template.find(`.tab.${tab}`);
    });

    template.find('.item-action').click(function () {
      const tab = $(this).data('tab');

      self.current_tab = tab;

      const select_tab = (tab) => {
        self['tab-button' + tab].addClass('active').siblings().removeClass('active');
        self['tab-container' + tab].show().addClass('active').siblings().hide().removeClass('active');
        self.current_tab = tab;
      };

      if (RM.is_mobile && !self.current_tab) {
        select_tab('items');
        return;
      }

      select_tab(tab);
    });

    RM.is_mobile && template.find('.item-action').click();

    return template;
  }

  resize() {
    const set_width = () => {
      if (RM.is_mini || RM.is_mobile) {
        this.modal.container.find('.order-manage').addClass(`mob`).removeClass('desk');

        if (!this.current_tab) {
          this['tab-buttonitems'] && this['tab-buttonitems'].addClass('active').siblings().removeClass('active');
          this['tab-containeritems'] &&
            this['tab-containeritems'].show().addClass('active').siblings().hide().removeClass('active');
          this.current_tab = 'items';

          this.select_last_order();
        }

        if (RM.is_mini) {
          this.modal.container.find('.order-manage').addClass('sm');
        } else {
          this.modal.container.find('.order-manage').removeClass('sm');
        }
      } else {
        this.modal.container.find('.order-manage').addClass('desk').removeClass('mob sm');
      }
    };

    set_width();
  }

  get last_order() {
    return this.last_child;
  }

  select_last_order() {
    if (this.last_order) {
      this.last_order.select();
    } else {
      //this.add_order();
    }
  }

  toggle_main_section(option) {
    /*this.current_layout = option || (this.current_layout === "items" ? "invoice" : "items");
    if (this.current_layout === "items"){
        this.items_wrapper.show();
        this.invoice_wrapper.hide();
        //this.current_order && this.current_order.pay_form && this.current_order.pay_form.save({}, true);
    }else{
        this.items_wrapper.hide();
        this.invoice_wrapper.show();
    }*/
  }

  in_objects(f) {
    Object.keys(this.objects).forEach((key) => {
      f(this.objects[key]);
    });
  }

  empty_inputs() {
    this.in_objects((obj) => {
      if (['qty', 'discount', 'rate'].includes(obj.properties.name)) {
        obj.val('', false);
      }
    });
  }

  make_edit_input() {
    const default_class = `input entry-order-editor input-with-feedback center`;

    const objs = [
      {
        name: 'Minus',
        tag: 'button',
        properties: {
          name: 'minus',
          class: `btn btn-default edit-button ${default_class}`,
        },
        content: '<span class="fa fa-minus">',
        on: {
          click: () => {
            if (this.num_pad.input && !this.num_pad.input.is_disabled) {
              const currentValue = parseFloat(this.num_pad.input.val()) || 0;
              if (currentValue > 0) {
                this.num_pad.input.minus();
              }
            }
          },
        },
      },
      {
        name: 'Qty',
        tag: 'button',
        label: 'Qty',
        properties: {
          name: 'qty',
          type: 'text',
          input_type: 'number',
          class: default_class,
        },
        on: {
          click: (obj) => {
            console.log('obj', obj);
            this.num_pad.input = obj;
          },
        },
      },
      {
        name: 'Discount',
        tag: 'button',
        label: 'Discount',
        properties: {
          name: 'discount',
          type: 'text',
          input_type: 'number',
          class: default_class,
        },
        on: {
          click: (obj) => {
            this.num_pad.input = obj;
          },
        },
      },
      {
        name: 'Rate',
        tag: 'button',
        label: 'Rate',
        properties: {
          name: 'rate',
          type: 'text',
          input_type: 'number',
          class: default_class,
        },
        on: {
          click: (obj) => {
            this.num_pad.input = obj;
          },
        },
      },
      {
        name: 'Plus',
        tag: 'button',
        properties: {
          name: 'plus',
          class: `btn btn-default edit-button ${default_class}`,
        },
        content: '<span class="fa fa-plus">',
        on: {
          click: () => {
            if (this.num_pad.input && !this.num_pad.input.is_disabled) {
              console.log('this.num_pad.input', this.num_pad.input);
              this.num_pad.input.plus();
            }
          },
        },
      },
      {
        name: 'Trash',
        tag: 'button',
        properties: {
          name: 'trash',
          class: `btn btn-default edit-button ${default_class}`,
        },
        content: '<span class="fa fa-trash">',
        on: {
          click: () => {
            const current_item = this.current_order ? this.current_order.current_item : null;

            if (current_item != null) {
              if (current_item.is_enabled_to_delete) {
                current_item.delete();
              } else {
                frappe.msgprint(__('You do not have permissions to delete Items'));
              }
            }
          },
        },
      },
    ];

    const container = '#' + this.editor_container_name;
    let base_html = '<thead><tr>';
    const width = [10, 20, 20, 20, 10, 10];

    objs.forEach((_obj) => {
      base_html += `
			<th class="center pad-head" style="font-size: 12px; padding: 4px">
				${_obj.label || ''}
			</th>`;
    });
    base_html += "</thead><tbody><tr class='edit-values'>";

    objs.forEach((element, index) => {
      base_html += `<td class='${this.table_name}-${index}' style='width: ${width[index]}%;'>`;

      this.#objects[element.name] = frappe
        .jshtml({
          tag: element.tag,
          properties: element.properties,
          content: element.content || '',
        })
        .on(
          Object.keys(element.on)[0],
          element.on[Object.keys(element.on)[0]],
          element.name === 'Trash' ? DOUBLE_CLICK : ''
        )
        .disable();

      base_html += this.objects[element.name].html();
    });

    $(container)
      .empty()
      .append(base_html + '</tr></tbody>');

    this.#objects.Qty.int();
    this.#objects.Discount.float(2);
    this.#objects.Rate.float();
  }

  update_detail(input) {
    if (RM.busy) return;

    const set_data = (item, qty, discount, rate) => {
      item.data.qty = qty;
      item.data.discount_percentage = discount;
      item.data.rate = rate;
      item.data.status = 'Pending';
      item.update();
      if (qty > 0) {
        item.select();
      }
    };

    if (this.current_order != null && this.current_order.current_item != null) {
      const current_item = this.current_order.current_item;
      if (!current_item.is_enabled_to_edit) {
        return;
      }

      const qty = flt(this.objects.Qty.val());
      let discount = flt(this.objects.Discount.val());
      let rate = flt(this.objects.Rate.val());
      const base_rate = flt(current_item.data.price_list_rate);

      if (input.properties.name === 'qty') {
        if (input.val() === 0 && current_item.is_enabled_to_delete) {
          frappe.msgprint(__('You do not have permissions to delete Items'));
          current_item.select();
          return;
        }
        set_data(current_item, qty, discount, rate);
      }
      if (input.properties.name === 'discount') {
        rate = base_rate * (1 - discount / 100);
        set_data(current_item, qty, discount, rate);
      }
      if (input.properties.name === 'rate') {
        const _discount = ((base_rate - rate) / base_rate) * 100;
        discount = _discount >= 0 ? _discount : 0;
        set_data(current_item, qty, discount, rate);
      }
    }
  }

  make_pad() {
    const default_class = `pad-col ${this.table_name}`;
    this.orders_count_badge = frappe.jshtml({
      tag: 'span',
      properties: { class: 'badge badge-tag badge-btn', style: 'font-size: 12px' },
      content: '{{text}}',
      text: 0,
    });

    const num_pads_components = [
      [
        [
          {
            name: 'Pad',
            props: { class: '', rowspan: 4, style: 'width: 65% !important; padding: 0' },
            action: 'none',
          },
          {
            name: 'Order',
            props: { class: 'lg pad-btn btn-success btn-order' },
            content: `<span class="fa fa-cutlery pull-right"></span>`,
            action: 'order',
          },
        ],
      ],
      [
        [
          {
            name: 'Account',
            props: { class: 'lg pad-btn' },
            content: '<span class="fa fa-file-o pull-right"></span>',
            action: 'print_account',
          },
        ],
      ],
      [
        [
          {
            name: 'Divide',
            props: { class: 'lg pad-btn' },
            content: '<span class="fa fa-files-o pull-right"></span>',
            action: 'divide',
          },
        ],
      ],
      [
        [
          {
            name: 'Transfer',
            props: { class: 'lg pad-btn' },
            content: '<span class="fa fa-share pull-right"></span>',
            action: 'transfer',
          },
        ],
      ],
      [
        [
          {
            name: 'Tax',
            props: { class: 'pad-label lg', style: 'padding-top: 3px; display: none;' },
            action: 'none',
          },
          {
            name: 'Pay',
            props: { class: 'md pay-btn text-lg btn-primary', rowspan: 2 },
            action: 'pay',
          },
        ],
        {
          style: 'height: 10px;',
        },
      ],
      [
        [
          {
            name: 'Total',
            props: { class: 'pad-label label-lg lg' },
            action: 'none',
          },
        ],
        {
          style: 'height: 15px;',
        },
      ],
    ];

    let base_html = '<tbody>';
    num_pads_components.forEach((row) => {
      const props = typeof row[1] != 'undefined' ? row[1] : {};
      base_html += `<tr style='${props.style || ''}'>`;

      row[0].forEach((col) => {
        col.props.class += ` ${default_class}-${col.name}`;
        this.#components[col.name] = frappe
          .jshtml({
            tag: 'td',
            properties: col.props,
            content: '{{text}}' + (col.content || ''),
            text:
              __(col.name === 'Tax' ? 'Taxes & Charges' : col.name === 'Pay' ? 'Complete' : col.name) +
              (['Tax', 'Total'].includes(col.name) ? ': ' + RM.format_currency(0) : ''),
          })
          .on(
            'click',
            () => {
              if (col.action !== 'none') {
                if (this.current_order == null) {
                  this.no_order_message();
                  return;
                }
                if (this.current_order.has_queue_items()) {
                  frappe.msgprint(__('Adding Items, please white'));
                  return;
                }
                setTimeout(`RM.object('${this.identifier}').current_order.${col.action}()`, 0);
              }
            },
            ['order', 'transfer'].includes(col.action) ? (!RM.restrictions.to_transfer_order ? DOUBLE_CLICK : null) : ''
          );

        base_html += this.components[col.name].html();
      });

      base_html += '</tr>';
    });

    $('#' + this.pad_container_name)
      .empty()
      .append(base_html + '</tbody>');

    setTimeout(() => {
      this.num_pad = new NumPad({
        wrapper: this.components.Pad.obj,
        on_enter: () => {
          if (this.num_pad.input && !this.num_pad.input.is_disabled) {
            this.update_detail(this.num_pad.input);
          }
        },
      });
      setTimeout(() => {
        this.check_buttons_status();
      }, 0);
    }, 0);
  }

  is_same_order(order = null) {
    return this.current_order && order && this.current_order.data.name === order.data.name;
  }

  no_order_message() {
    frappe.msgprint('Not order Selected');
  }

  in_components(f) {
    Object.keys(this.components).forEach((k) => {
      if (typeof this.#components[k] != 'undefined') {
        f(this.components[k], k);
      }
    });
  }

  reset_order_button() {
    this.#components.Order.set_content(
      `<span class="fa fa-cutlery pull-right"></span>${__('Order')}{{text}}`
    ).reset_confirm();
  }

  disable_components() {
    this.reset_order_button();
    this.in_components((component, k) => {
      if (!['Pad', 'Tax', 'Total', 'Pay'].includes(k)) {
        component.disable();

        if (['delete', 'edit', 'new', 'new_order'].includes(k)) {
          component.hide();
        }
      }
    });
  }

  check_buttons_status() {
    if (this.current_order == null) {
      this.disable_components();
      if (typeof this.#components.new_order_button != 'undefined') {
        this.#components.new_order_button.enable().show();
      }

      return;
    } else {
      if (RM.check_permissions('order', null, 'create')) {
        if (typeof this.#components.new_order_button != 'undefined') {
          this.#components.new_order_button.enable().show();
        }
      } else {
        if (typeof this.#components.new_order_button != 'undefined') {
          this.#components.new_order_button.disable().hide();
        }
      }
    }

    if (this.current_order.data.status !== 'Invoiced') {
      if (this.current_order.items_count === 0) {
        if (RM.check_permissions('order', this.current_order, 'delete')) {
          this.#components.delete.enable().show();
        } else {
          this.#components.delete.disable().hide();
        }
      } else {
        this.#components.delete.disable().hide();
        //this.#components.Pay.prop("disabled", !RM.can_pay);
        this.current_order &&
          this.current_order &&
          this.current_order.pay_form &&
          this.current_order.pay_form.disable_input('payment_button', !RM.can_pay);
      }

      if (RM.check_permissions('order', this.current_order, 'write')) {
        if (this.current_order.has_queue_items()) {
          this.#components.Order.enable().add_class('btn-danger').val(__('Add'));
        } else {
          const orders_count = this.current_order.data.products_not_ordered;
          this.orders_count_badge.val(`${orders_count}`);
          const [action, text] = [
            orders_count > 0 ? 'enable' : 'disable',
            orders_count > 0 ? this.orders_count_badge.html() : '',
          ];

          this.#components.Order.set_content(
            `<span class="fa fa-cutlery pull-right"></span>${__('Order')}${text}{{text}}`
          )[action]();
        }

        this.#components.Divide.prop('disabled', this.current_order.items_count === 0);
        this.#components.customer.enable().show();
        // this.#components.customer_group.enable().show();
        this.#components.dinners.enable().show();
        this.#components.Transfer.enable();
      } else {
        this.#components.customer.disable().hide();
        this.#components.dinners.disable().hide();
        this.#components.Transfer.disable();
        this.#components.Order.disable();
        this.#components.Divide.disable();
      }
    } else {
      this.disable_components();
    }

    this.#components.Account.prop(
      'disabled',
      !RM.check_permissions('order', this.current_order, 'print') || this.current_order.items_count === 0
    );
  }

  check_item_editor_status(item = null) {
    /** item OrderItem class **/
    const objects = this.#objects;
    if (item == null) {
      this.empty_inputs();
      this.in_objects((input) => {
        input.disable();
      });
      return;
    }

    const pos_profile = RM.pos_profile;
    const data = item.data;
    const item_is_enabled_to_edit = item.is_enabled_to_edit;

    objects.Qty.prop('disabled', !item_is_enabled_to_edit).val(data.qty, false);

    objects.Discount.prop('disabled', !item_is_enabled_to_edit || !pos_profile.allow_discount_change).val(
      data.discount_percentage,
      false
    );

    objects.Rate.prop('disabled', !item_is_enabled_to_edit || !pos_profile.allow_rate_change).val(data.rate, false);

    objects.Minus.prop('disabled', !item_is_enabled_to_edit);
    objects.Plus.prop('disabled', !item_is_enabled_to_edit);
    objects.Trash.prop('disabled', !item.is_enabled_to_delete || !item_is_enabled_to_edit);

    item.check_status();
  }

  make_items() {
    this.#items = new ItemsTree({
      wrapper: $(`#${this.item_container_name}`),
      order_manage: this,
      in_menu: true,
    });
  }

  storage() {
    return this.#items;
  }

  add_order() {
    console.log('Test enviando orden');
    RM.working('Adding Order');
    frappeHelper.api.call({
      model: 'Restaurant Object',
      name: this.table.data.name,
      method: 'add_order',
      args: { client: RM.client },
      always: (r) => {
        RM.ready();
        if (typeof r.message != 'undefined') {
          RM.sound_submit();
          //RM.is_mobile && this.select_last_order();
          this.select_last_order();
        }
      },
    });
  }

  get_orders(current = null) {
    RM.working(__('Loading Orders in') + ': ' + this.title);
    frappeHelper.api.call({
      model: 'Restaurant Object',
      name: this.table.data.name,
      method: 'orders_list',
      args: RM.crm_customer ? { customer: RM.crm_customer } : {},
      always: (r) => {
        RM.ready();
        if (r.message) {
          current = r.message.order || current;
          this.make_orders(r.message.orders, current);
        }
      },
    });
  }

  in_orders(f) {
    this.in_child((child, key, index) => {
      f(child, key, index);
    });
  }

  check_permissions_status() {
    this.is_enabled_to_open();
    this.in_orders((order) => {
      order.button.content = order.content;
      order.button
        .css('color', RM.check_permissions('order', order, 'write') ? 'unset' : RM.restrictions.color)
        .val(order.data.items_count);
      if (this.is_same_order(order)) {
        this.check_buttons_status();
        this.check_item_editor_status(order.current_item);
      }
    });
  }

  check_data(data) {
    const _data = data.data.order.data;
    return super.append_child({
      child: _data,
      exist: (o) => {
        if (!o) return;
        if ([UPDATE, QUEUE, SPLIT].includes(data.action) && _data.show_in_pos === 1) {
          o.reset_data(data.data, data.action);
        } else if ([DELETE, INVOICED, TRANSFER].includes(data.action) || _data.show_in_pos !== 1) {
          this.delete_order(o.data.name);
        }
      },
      not_exist: () => {
        if (_data.show_in_pos !== 1) return;

        const new_order = new TableOrder({
          order_manage: this,
          data: Object.assign({}, _data),
        });

        if (RM.client === RM.request_client && new_order) {
          setTimeout(() => {
            new_order.select();
          }, 0);
        }

        return new_order;
      },
    });
  }

  get_order(name) {
    return super.get_child(name);
  }

  make_orders(orders = [], current = null) {
    orders.forEach((order) => {
      this.append_order(order, current);
    });

    if (this.#components.new_order_button) {
      this.#components.new_order_button.remove();
    }

    const new_order_button = frappe
      .jshtml({
        test_field: true,
        tag: 'button',
        properties: {
          class: 'btn btn-app btn-lg btn-order',
          style: 'background-color: var(--fill_color)',
        },
        content: `<span class="fa fa-plus"></span>`,
      })
      .on(
        'click',
        () => {
          this.add_order();
        },
        !RM.restrictions.to_new_order ? DOUBLE_CLICK : null
      );

    this.#components.new_order_button = new_order_button;

    if (this.#components.new_order_button) {
      $(this.order_container).prepend(new_order_button.html());
    }

    RM.is_mobile && this.select_last_order();
  }

  append_order(order, current = null) {
    return super.append_child({
      child: order,
      not_exist: () => {
        return new TableOrder({
          order_manage: this,
          data: Object.assign({}, order.data),
        });
      },
      always: (o) => {
        if (current != null && current === o.data.name) {
          setTimeout(() => {
            o.select();
          }, 0);
        }
      },
    });
  }

  delete_current_order() {
    if (this.current_order != null) {
      this.current_order.delete();
    }
  }

  update_current_order(type) {
    if (this.current_order != null) {
      this.current_order.edit(type);
    }
  }

  clear_current_order() {
    this.#components.Tax.val(`${__('Taxes & Charges')}: ${RM.format_currency(0)}`);
    this.#components.Total.val(`${__('Total')}: ${RM.format_currency(0)}`);
    this.check_item_editor_status();

    if (this.current_order != null) {
      this.delete_order(this.current_order.data.name);
    }
  }

  delete_order(order_name) {
    const order = this.get_order(order_name);
    if (order != null) {
      order.delete_items();
      order.pay_form && order.pay_form.remove();
      order.pay_form = null;
      if (this.is_same_order(order)) {
        this.current_order = null;
        this.clear_current_order();
      }
      super.delete_child(order_name);

      order.button.remove();
      order.container.remove();
      this.check_buttons_status();
      this.order_status_message();
    }
  }

  order_status_message() {
    const container = $('#' + this.identifier);

    if (this.current_order) {
      container.addClass('has-order');
      if (this.current_order.items_count === 0) {
        container.removeClass('has-items');
      } else {
        container.addClass('has-items');
      }
    } else {
      container.removeClass('has-order');
      container.removeClass('has-items');
    }

    this.#items.update_items((this.current_order && this.current_order.items) || []);
  }
}

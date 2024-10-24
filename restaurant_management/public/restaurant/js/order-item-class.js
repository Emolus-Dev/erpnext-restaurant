class OrderItem {
  enabled_form_fields_status = {
    Pending: ['qty', 'rate', 'notes', 'batch_no', 'serial_no'],
    Attending: ['qty', 'rate', 'notes', 'batch_no', 'serial_no'],
    Sent: ['notes'],
    Processing: ['notes'],
  };

  constructor(options) {
    Object.assign(this, options);

    this.totalChoices = 0;
    this.maxChoices = 0;

    this.attending_status = this.order.data.attending_status;
    this.status_enabled_for_edit = [this.attending_status, 'Pending', null, undefined, ''];
    this.status_enabled_for_delete = [this.attending_status, 'Pending', 'Sent', null, undefined, ''];

    this.render();
    this.init_synchronize();
  }

  init_synchronize() {
    frappe.realtime.on('pos_profile_update', () => {
      setTimeout(() => {
        this.active_editor();
      }, 0);
    });
  }

  hide() {
    this.row.hide();
  }

  get is_enabled_to_edit() {
    return (
      this.status_enabled_for_edit.includes(this.data.status) && RM.check_permissions('order', this.order, 'write')
    );
  }

  get is_enabled_to_delete() {
    return (
      this.status_enabled_for_delete.includes(this.data.status) && RM.check_permissions('order', this.order, 'write') // &&
      //RM.check_permissions("pos", null, "delete")
    );
  }

  reset_html() {
    const ps = this.data.process_status_data;

    this.amount.val(RM.format_currency(this.data.amount));
    this.detail.val(this.html_detail);
    this.notes.val(this.data.notes);
    this.icon.val(`<i class="${ps.icon}" style="color: ${ps.color}"></i>`);

    this.form_editor && this.form_editor.reload(this.data, false);
  }

  delete() {
    if (RM.busy_message() || !this.is_enabled_to_delete) return;
    this.data.qty = 0;
    if (this.data.status === 'Pending') {
      this.order.delete_item(this.data.identifier);
    } else {
      this.update(true);
    }
  }

  remove() {
    this.row.remove();
  }

  render() {
    this.row = frappe.jshtml({
      tag: 'li',
      properties: { class: 'media event' },
      content: this.template,
    });

    this.order.container.append(this.row.html());
  }

  async select(scroller = false) {
    this.order.current_item = this;
    this.order.order_manage.check_item_editor_status(this);
    this.row.toggle_common('media.event', 'selected');
    //this.order.order_manage.toggle_main_section("items");

    if (scroller) this.order.scroller();
  }

  active_editor() {
    if (typeof this.order == 'undefined') return;
    this.order.order_manage.check_item_editor_status(this);
  }

  update(server = true) {
    if (this.edit_item) return;
    if (this.data.qty === 0 && !this.is_enabled_to_delete) {
      frappe.throw(__('You do not have permissions to delete Items'));
    }

    if (this.data.qty === 0) {
      //this.order.delete_item(this.data.identifier);
    } else {
      this.calculate();
      this.reset_html();
    }

    this.order.aggregate(true);
    if (!server) return;

    RM.working('Update Item', false);

    window.saving = true;

    this.data = Object.entries(this.data).reduce((acc, [key, value]) => {
      acc[key] = value === 0 ? 0 : value || '';
      return acc;
    }, {});

    // Asegúrate de que las notas se actualicen en la interfaz
    this.notes.val(this.data.notes);

    frappeHelper.api.call({
      model: 'Table Order',
      name: this.order.data.name,
      method: this.data.qty > 0 ? 'push_item' : 'delete_item',
      args: { item: this.data.qty > 0 ? this.data : this.data.identifier },
      always: (r) => {
        if (r.exc) {
          this.order.check_items({ items: [...Object.values(this.order.items).map((item) => item.data), this.data] });
        }
        this.order.aggregate(true);

        window.saving = false;
        RM.ready();
      },
    });
  }

  calculate() {
    const base_amount = flt(this.data.qty) * flt(this.data.rate);
    this.tax_calculate(base_amount);

    this.order.order_manage.objects.Qty.val(this.data.qty);
    this.order.order_manage.objects.Rate.val(this.data.rate);
    this.order.order_manage.objects.Discount.val(this.data.discount_percentage);

    this.order.aggregate(true);
  }

  calculate_form(input, value) {
    /**TODO: merge with general order management function */
    const set_data = (qty, discount, rate) => {
      this.data.qty = qty;
      this.data.discount_percentage = discount;
      this.data.rate = rate;
    };

    if (input && ['qty', 'rate', 'discount_percentage'].includes(input)) {
      //const input_field = this.form_editor.get_field(input);
      if (!this.is_enabled_to_edit) {
        return;
      }

      const qty_field = this.form_editor.get_field('qty');
      const rate_field = this.form_editor.get_field('rate');
      const discount_field = this.form_editor.get_field('discount_percentage');

      const qty = flt(qty_field.get_value());
      let discount = flt(discount_field.get_value());
      let rate = flt(rate_field.get_value());
      const base_rate = flt(this.data.price_list_rate);

      if (input === 'qty') {
        if (value === 0 && this.is_enabled_to_delete) {
          frappe.msgprint(__('You do not have permissions to delete Items'));
          return;
        }
        set_data(qty, discount, rate);
      }

      if (input === 'discount_percentage') {
        rate = base_rate * (1 - discount / 100);
        set_data(qty, discount, rate);
      }

      if (input === 'rate') {
        const _discount = ((base_rate - rate) / base_rate) * 100;
        discount = _discount >= 0 ? _discount : 0;
        set_data(qty, discount, rate);
      }
    } else {
      this.data[input] = value;
    }
    /**merge with general order management function */
  }

  tax_calculate(base_amount) {
    const tax_inclusive = RM.pos_profile.posa_tax_inclusive;

    const tax_amount = Object.values(RMHelper.JSONparse(this.data.item_tax_rate) || {}).reduce((acc, cur) => {
      if (tax_inclusive) {
        const base_without_tax = base_amount / (1 + cur / 100);
        return acc + base_without_tax * (cur / 100);
      } else {
        return acc + (base_amount * cur) / 100;
      }
    }, 0);

    this.data.tax_amount = tax_amount;
    this.data.amount = base_amount + (tax_inclusive ? 0 : tax_amount);
  }

  discount_calculate(base_amount) {
    const discount_amount = flt(this.data.discount_amount);
    const discount_percentage = flt(this.data.discount_percentage);
    const tax_amount = flt(this.data.tax_amount);

    if (discount_amount > 0) {
      this.data.amount = base_amount + tax_amount - discount_amount;
    } else if (discount_percentage > 0) {
      this.data.discount_amount = base_amount * (discount_percentage / 100);
      this.data.amount = base_amount + tax_amount - this.data.discount_amount;
    } else {
      this.data.amount = base_amount + tax_amount;
    }
  }

  get template() {
    const psd = this.data.process_status_data;

    this.icon = frappe.jshtml({
      tag: 'a',
      properties: { class: 'pull-left border-aero profile_thumb' },
      content: `<i class="${psd.icon}" style="color: ${psd.color}"></i>`,
    });

    this.notes = frappe.jshtml({
      tag: 'small',
      properties: { class: 'notes' },
      content: typeof this.data.notes == 'object' ? '' : this.data.notes,
    });

    this.detail = frappe.jshtml({
      tag: 'p',
      content: this.html_detail,
    });

    this.amount = frappe.jshtml({
      tag: 'a',
      properties: { class: 'pull-right' },
      content: RM.format_currency(this.data.amount),
    });

    this.form_editor_container = frappe.jshtml({
      tag: 'div',
      properties: { class: 'form-editor p-2' },
    });

    const header_template = `
      ${this.icon.html()}
      <div class="media-body">
          <a class="title" href="javascript:void(0)">${this.data.item_name}
              ${this.amount.html()}
          </a>
          ${this.detail.html()}
          <p class="text-muted m-0">  ${this.notes.html()}</p>
      </div>
      `;

    this.header = frappe
      .jshtml({
        tag: 'div',
        properties: { class: 'widget-user-header' },
        content: header_template,
      })
      .on('click', () => {
        RM.pull_alert('left');
        this.make_form_editor();
        this.select();
      })
      .on('dblclick', () => {
        RM.pull_alert('left');
        this.make_form_editor();
        this.select();
        this.open_choices_dialog();
      });

    return `
      <div class="card card-widget widget-user-2">
        ${this.header.html()}
        <div class="card-footer p-0">
            ${this.form_editor_container.html()}
        </div>
      </div>
      `;
  }

  async open_choices_dialog() {
    console.log('open_choices_dialog', this.data);

    let items_response = await this.get_product_bundle(this.data.item_code);
    console.log('res', items_response);

    this.dialog_choices(items_response);
  }

  dialog_choices(items) {
    if (this.current_dialog) {
      this.current_dialog.hide();
      this.current_dialog = null;
    }

    this.quantities = {};

    const dialog = new frappe.ui.Dialog({
      title: `${this.data.item_code} - ${this.data.item_name}`,
      fields: [
        {
          fieldname: 'html_container',
          fieldtype: 'HTML',
        },
      ],
      size: 'large',
      static: true,
      primary_action_label: __('Save'),
      primary_action: () => {
        this.saveDialogData(items, dialog);
      },
      secondary_action_label: __('Cancel'),
      secondary_action: () => {
        dialog.hide();
      },
    });

    this.current_dialog = dialog;
    this.maxChoices = items[0].custom_max_choices || 0;

    // Ocultar el botón "Guardar" inicialmente
    dialog.get_primary_btn().addClass('hide');

    // Insertar estilos y contenido HTML
    const dialogContent = `
      <style>
        .choices-dialog .item-card {
          display: flex;
          height: 160px;
          overflow: hidden;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          margin-bottom: 15px;
          background: white;
        }
        .choices-dialog .item-details {
          flex: 1;
          padding: 10px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .choices-dialog .item-image {
          width: 120px;
          height: 160px;
          overflow: hidden;
        }
        .choices-dialog .item-image img {
          object-fit: cover;
          width: 100%;
          height: 100%;
        }
        .choices-dialog .no-image {
          font-size: 30px;
          color: var(--gray-500);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          background-color: #f8f9fa;
        }
        .choices-dialog .item-actions {
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
        }
        .choices-dialog .btn-group {
          display: flex;
          justify-content: flex-start;
          margin-bottom: 5px;
          gap: 0;
        }
        .choices-dialog .btn-group .btn {
          padding: 4px 10px;
          border: 1px solid #ced4da;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 36px;
        }
        .choices-dialog .btn-group .quantity-display {
          min-width: 50px;
          justify-content: center;
          display: flex;
          align-items: center;
          user-select: none;
        }
        .choices-dialog .item-notes {
          margin-top: 5px;
        }
        .choices-dialog .item-notes textarea {
          width: 100%;
          padding: 2px 5px;
          font-size: 12px;
          resize: none;
          height: 40px;
          border: 1px solid #ced4da;
          border-radius: 4px;
        }
        .choices-dialog .card-title {
          font-size: 14px;
          margin-bottom: 5px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .choices-dialog .card-text {
          font-size: 12px;
          color: #6c757d;
          margin: 0;
        }
        .choices-dialog .btn-outline-secondary {
          background-color: white;
        }
        .choices-dialog .btn-outline-secondary:hover {
          background-color: #f8f9fa;
        }
      </style>
      <div class="choices-dialog">
        <div class="row">
          ${items.map((item) => this.generate_item_html(item)).join('')}
        </div>
      </div>
    `;

    dialog.fields_dict.html_container.$wrapper.empty().html(dialogContent);
    this.setupDialogEvents(dialog);

    items.forEach((item) => {
      this.quantities[item.item_code] = 0;
      this.updateQuantityDisplay(item.item_code);
    });

    this.updateTotalChoices();
    dialog.show();
  }

  setupDialogEvents(dialog) {
    const wrapper = dialog.fields_dict.html_container.$wrapper;

    // Remover eventos anteriores si existen
    // wrapper.off('click.itemActions');

    // // Usar un solo delegado de eventos para todos los clics
    // wrapper.on('click.itemActions', (e) => {
    //   const target = $(e.target);

    //   if (target.hasClass('increment-btn') || target.closest('.increment-btn').length) {
    //     const itemCode = target.closest('[data-item-code]').data('item-code');
    //     this.quantities[itemCode] = (this.quantities[itemCode] || 0) + 1;
    //     this.updateQuantityDisplay(itemCode);
    //   }

    //   if (target.hasClass('decrement-btn') || target.closest('.decrement-btn').length) {
    //     const itemCode = target.closest('[data-item-code]').data('item-code');
    //     if (this.quantities[itemCode] > 0) {
    //       this.quantities[itemCode]--;
    //       this.updateQuantityDisplay(itemCode);
    //     }
    //   }
    // });

    wrapper.on('click.itemActions', async (e) => {
      const target = $(e.target);
      let itemCode;

      if (target.hasClass('increment-btn') || target.closest('.increment-btn').length) {
        itemCode = target.closest('[data-item-code]').data('item-code');
        this.quantities[itemCode] = (this.quantities[itemCode] || 0) + 1;
        this.updateQuantityDisplay(itemCode);
        await this.updateTotalChoices();
      }

      if (target.hasClass('decrement-btn') || target.closest('.decrement-btn').length) {
        itemCode = target.closest('[data-item-code]').data('item-code');
        if (this.quantities[itemCode] > 0) {
          this.quantities[itemCode]--;
          this.updateQuantityDisplay(itemCode);
          await this.updateTotalChoices();
        }
      }
    });
  }

  saveDialogData(items, dialog) {
    const notes = [];

    items.forEach((item) => {
      const quantity = this.quantities[item.item_code] || 0;
      const notesElement = dialog.fields_dict.html_container.$wrapper.find(`#notes-${item.item_code}`);
      const itemNotes = notesElement.val()?.trim() || '';

      if (quantity > 0) {
        let noteText = `${item.item_name}: ${quantity}`;
        if (itemNotes) {
          noteText += ` (${itemNotes})`;
        }
        notes.push(noteText);
      }
    });

    this.data.notes = notes.join(', ');
    this.update();
    dialog.hide();
  }

  updateQuantityDisplay(itemCode) {
    const quantityElement = this.current_dialog?.fields_dict.html_container.$wrapper.find(`#quantity-${itemCode}`);

    if (quantityElement?.length) {
      quantityElement.text(this.quantities[itemCode] || 0);
    }
  }

  generate_item_html(item) {
    return `
    <div class="col-md-6 mb-3">
      <div class="item-card" data-item-code="${item.item_code}">
        <div class="item-details">
          <div>
            <h5 class="card-title">
              <i class="fa fa-circle" style="color: var(--${item.veg ? 'success' : 'danger'}); font-size: 10px;"></i>
              ${item.item_name}
            </h5>
            <p class="card-text">${item.item_code}</p>
          </div>
          <div class="item-actions">
            <div class="btn-group" role="group">
              <button class="btn btn-sm btn-outline-secondary decrement-btn" type="button">-</button>
              <span class="btn btn-sm btn-outline-secondary quantity-display" id="quantity-${item.item_code}">0</span>
              <button class="btn btn-sm btn-outline-secondary increment-btn" type="button">+</button>
            </div>
            <div class="item-notes">
              <textarea
                placeholder="Agregar notas"
                id="notes-${item.item_code}"
                class="input-with-feedback form-control"
              ></textarea>
            </div>
          </div>
        </div>
        <div class="item-image">
          ${
            item.item_image
              ? `<img src="${item.item_image}" alt="${item.item_name}" loading="lazy" decoding="async">`
              : `<div class="no-image">${frappe.get_abbr(item.item_name)}</div>`
          }
        </div>
      </div>
    </div>`;
  }

  async get_product_bundle(item_code) {
    const { message } = await frappe.call({
      method: 'restaurant_management.api.get_product_bundle_choices',
      args: { item_code },
    });

    return message;
  }

  async validateChoices() {
    const { message } = await frappe.call({
      method: 'restaurant_management.api.validate_max_choices',
      args: {
        item_code: this.data.item_code,
        max_choices: this.totalChoices,
        qty_items: this.data.qty,
      },
    });

    console.log('message', message);

    if (message.status === 'error') {
      // Si el error es debido a que no se encontró la configuración, manejarlo de manera diferente
      if (message.message === 'No se encontró la configuración de Product Bundle') {
        frappe.msgprint(__('Error: No se encontró la configuración de Product Bundle'));
        return { isValid: false, message: message.message };
      }
      // Para otros errores (como exceder el máximo), retornar como antes
      return { isValid: false, message: message.message };
    }

    // Si todo está bien, retornar éxito
    return { isValid: true, message: message.message };
  }

  async updateTotalChoices() {
    this.totalChoices = Object.values(this.quantities).reduce((sum, qty) => sum + qty, 0);
    const { isValid, message } = await this.validateChoices();

    if (this.current_dialog) {
      const saveButton = this.current_dialog.get_primary_btn();
      if (isValid) {
        saveButton.removeClass('hide');
        // No mostraremos alerta para el caso de éxito
      } else {
        saveButton.addClass('hide');
        // Mostrar alerta solo cuando se supera el máximo permitido
        frappe.show_alert({
          message: __(message),
          indicator: 'red',
        });
      }
    }
  }

  async updateSaveButtonVisibility() {
    const isValid = await this.validateChoices();
    if (this.current_dialog) {
      const saveButton = this.current_dialog.get_primary_btn();
      if (isValid) {
        saveButton.removeClass('hide');
      } else {
        saveButton.addClass('hide');
        frappe.throw(__(`You can select a maximum of ${this.maxChoices} items.`));
      }
    }
  }

  async make_form_editor() {
    if (this.form_editor) {
      const selected = this.row.has_class('selected');
      await this.form_editor.reload(this.data);

      this.form_editor[!selected || this.form_editor.in_modal ? 'show' : 'toggle']();
    } else {
      this.form_editor = new OrderItemEditor({
        order_item: this,
        location: this.form_editor_container.JQ(),
        doc: this.data,
        field_properties: {
          item_code: {
            read_only: true,
          },
          has_batch_no: {
            read_only: true,
            hidden: this.data.has_batch_no === 0,
          },
          batch_no: {
            hidden: this.data.has_batch_no === 0,
            get_query: () => {
              return {
                filters: [
                  ['item', '=', this.data.item_code],
                  ['disabled', '=', 0],
                  ['batch_qty', '>', 0],
                ],
              };
            },
          },
          has_serial_no: {
            read_only: true,
            hidden: this.data.has_serial_no === 0,
          },
          serial_no: {
            hidden: this.data.has_serial_no === 0,
            get_query: () => {
              return {
                filters: [
                  ['item_code', '=', this.data.item_code],
                  ['status', '=', 'Active'],
                ],
              };
            },
          },
        },
      });
    }
  }

  check_status() {
    if (this.form_editor) {
      const fields = this.form_editor.get_fields();

      Object.entries(fields).forEach(([field_name, field]) => {
        const enabled = (this.enabled_form_fields_status[this.data.status] || []).includes(field_name);

        this.form_editor.set_field_property(field_name, 'read_only', !enabled);
      });

      const pos_profile = RM.pos_profile;

      this.form_editor.set_field_property('qty', 'read_only', !this.is_enabled_to_edit);

      this.form_editor.set_field_property('qty', 'hidden', 1);
      this.form_editor.set_field_property('qty', 'item_code', 1);

      this.form_editor.set_field_property(
        'discount_percentage',
        'read_only',
        !this.is_enabled_to_edit || !pos_profile.allow_discount_change
      );
      this.form_editor.set_field_property(
        'rate',
        'read_only',
        !this.is_enabled_to_edit || !pos_profile.allow_rate_change
      );
    }
  }

  get html_detail() {
    const rate = flt(this.data.rate, 2);
    const discount_percentage = flt(this.data.discount_percentage, RM.currency_precision);

    const discount_info = discount_percentage
      ? `
			<small class="badge" style="background-color: var(--dark); color: var(--green); padding:5px; display: inline;">
				<label>${discount_percentage}%<span class="fa fa-tags" style="padding-left: 5px;"></span></label>
			</small>`
      : '';

    return `${this.data.qty} x @${RM.format_currency(rate)} ${discount_info}`;
  }
}

class OrderItemEditor extends DeskForm {
  reload_from_doc = true;
  primary_action_label = __('Update');
  title = __('Item Editor');
  desk_form = RM.order_item_editor_form;
  disabled_to_save = true;

  constructor(opts) {
    super(opts);

    this.order_item = opts.order_item;
    super.initialize();
  }

  async make() {
    await super.make();

    const update = (field) => {
      if (this.order_item.data[field.df.fieldname] === field.get_value()) return;

      this.order_item.calculate_form(field.df.fieldname, field.get_value());
      this.order_item.calculate();
      this.order_item.update();
    };

    this.on(['qty', 'rate', 'discount_percentage', 'batch_no'], 'change', (field) => {
      update(field);
    });

    this.get_input('notes')
      .css('height', '100px')
      .on('focusout', (e) => {
        update(this.get_field('notes'));
      });
  }

  on_refresh_dependency() {
    this.order_item.check_status();
  }
}

// Función para actualizar las notas
function updateNotes(itemCode) {
  const notesInput = document.getElementById(`notes-${itemCode}`);
  const notes = notesInput.value;
  console.log(`Notas actualizadas para el ítem ${itemCode}: ${notes}`);
  // Aquí puedes agregar la lógica para guardar las notas en tu sistema
}

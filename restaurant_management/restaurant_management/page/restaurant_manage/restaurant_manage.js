/**RestaurantManagement**/
var RM = null;
const [TRANSFER, UPDATE, DELETE, INVOICED, ADD, QUEUE, SPLIT, DOUBLE_CLICK_DELAY] = [
  'Transfer',
  'Update',
  'Delete',
  'Invoiced',
  'Add',
  'queue',
  'Split',
  'double_click',
];
frappe.provide('erpnext.PointOfSale');

frappe.pages['restaurant-manage'].on_page_load = function (wrapper) {
  frappe.ui.make_app_page({
    parent: wrapper,
    title: '',
    single_column: true,
  });

  $('body').hide();

  frappe.db.get_value('POS Settings', { name: 'POS Settings' }, 'is_online', (r) => {
    if (r && !cint(r.use_pos_in_offline_mode)) {
      RM = new RestaurantManage(wrapper);
    }
  });
};

frappe.pages['restaurant-manage'].refresh = function () {
  if (window.crm_customer && RM) {
    RM.crm_customer = window.crm_customer;
    window.crm_customer = null;
    if (RM.objects[RM.crm_settings.crm_room]) {
      RM.objects[RM.crm_settings.crm_room].select();
    } else {
      frappe.throw(__('Please set a CRM Table in POS Profile, to create a new order from CRM'));
    }
  }

  if (RM && RM.navigate_room) {
    const navigate = RM.navigate_room;
    RM.navigate_room = null;
    RM.objects[navigate].select();
    //RM.navigate_room = null;
  }
};

RestaurantManage = class RestaurantManage {
  #pos_profile = null;
  #permissions = null;
  #exceptions = null;
  #restrictions = null;
  #company = null;
  #components = [];
  #lang = null;
  currency_precision = 2;
  editing = false;
  transfer_order = null;
  current_room = null;
  busy = false;
  sounds = false;
  client = this.uuid();
  request_client = null;
  loaded = false;
  store = {
    items: [],
  };
  objects = [];

  room = [];

  constructor(wrapper) {
    this.base_wrapper = wrapper;
    this.wrapper = $(wrapper).find('.layout-main-section');
    this.page = wrapper.page;
    this.url_manage = 'restaurant_management.restaurant_management.page.restaurant_manage.restaurant_manage.';
    this.#company = frappe.defaults.get_user_default('company');

    const assets = [
      'js/pos-restaurant-controller.js',
      'js/restaurant-room-class.js',
      'js/restaurant-object-class.js',
      'js/reservation-manage.js',

      'js/order-manage-class.js',
      'js/menu-manage-class.js',
      'js/product-item-class.js',
      'js/items-tree-class.js',
      'js/order-item-class.js',

      'js/process-manage-class.js',
      'js/food-command-class.js',
      'js/table-order-class.js',
      'js/pay-form-class.js',
      'js/invoice-class.js',

      'css/restaurant-room.css',
      'css/action-buttons.css',
      'css/editor-order.css',
      'css/food-command.css',
      'css/order-buttons.css',
      'css/order-items.css',
      'css/order-items-container.css',
      'css/order-manage.css',
      'css/process-manage.css',
      'css/product-list.css',
      'css/restaurant-object.css',
    ].map((asset) => `assets/restaurant_management/restaurant/${asset}`);

    frappe.require(assets, () => {
      this.make();
    });

    this.onResize(() => {
      this.is_mini = window.innerWidth < 400;
      this.is_mobile = window.innerWidth < 768;
      this.is_tablet = window.innerWidth < 992;
      this.is_desktop = window.innerWidth >= 992;
      this.is_landscape = window.innerWidth > window.innerHeight;
      this.is_portrait = window.innerWidth < window.innerHeight;
      this.is_small = window.innerWidth < 576;
    });
  }

  onResize(fn) {
    window.addEventListener('resize', () => {
      fn();
    });

    fn();
  }

  make() {
    return frappe.run_serially([
      () => frappe.dom.freeze(),
      () => this.prepare_dom(),
      () => {
        this.working('Set settings');
        this.settings_data.then(() => {
          this.pos = new erpnext.PointOfSale.RestaurantController(this.wrapper);
          window.cur_pos = this.pos;

          this.make_rooms().then(() => {
            setTimeout(() => {
              this.check_permissions_status();
            }, 100);
          });
        });
      },
      () => {
        frappe.dom.unfreeze();
      },
      () => this.page.set_title(__('Restaurant Manage')),
      () => this.init_synchronize(),
      () => this.page.$title_area.hide(),
    ]);
  }

  test_pos() {
    if (this.loaded && this.pos_profile == null) {
      this.raise_exception_for_pos_profile();
    }
  }

  raise_exception_for_pos_profile() {
    if ($(this.base_wrapper).is(':visible')) {
      frappe.throw(this.not_has_pos_profile_message);
    }
  }

  get not_has_pos_profile_message() {
    return __('POS Profile is required to use Point-of-Sale');
  }

  prepare_dom() {
    const self = this;
    this.rooms_container = frappe.jshtml({
      tag: 'div',
      properties: {
        style: 'display: flex; width: 100%',
      },
    });

    this.floor_map = frappe
      .jshtml({
        tag: 'div',
        properties: { class: 'table-container-scroll' },
      })
      .on('click', () => {
        RM.unselect_all_tables();
      });

    this.#components.add_table = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-default btn-flat' },
        content: `<span class="fa fa-plus"></span> ${__('Table')}`,
      })
      .on('click', () => {
        this.add_object('Table');
      });

    this.#components.add_production_center = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-default btn-flat' },
        content: `<span class="fa fa-plus"></span> ${__('P Center')}`,
      })
      .on('click', () => {
        this.add_object('Production Center');
      });

    this.#components.reservation = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-danger', style: 'font-size: 16px; opacity: 0.8;' },
        content: `<span class="fa fa-check"></span> ${__('Check In')}`,
      })
      .on('click', () => {
        if (this.check_in) {
          //this.check_in.reload();
          this.check_in.show();
          return;
        } else {
          this.check_in = new CheckIn({}); //.show();
        }
      });

    this.#components.edit_room = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-default btn-flat' },
        content: `<span class="fa fa-pencil"></span> ${__('Edit')}`,
      })
      .on('click', () => {
        if (this.current_room != null) this.current_room.edit();
      });

    this.#components.delete_room = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-default btn-flat' },
        content: `<span class="fa fa-trash"></span> {{text}}`,
        text: __('Delete'),
      })
      .on(
        'click',
        () => {
          if (this.current_room != null) this.current_room.delete();
        },
        DOUBLE_CLICK
      );

    this.#components.menu_manage = frappe
      .jshtml({
        tag: 'button',
        properties: { class: 'btn btn-default btn-flat' },
        content: `<span class="fa fa-bars"></span> ${__('Menu')}`,
      })
      .on('click', () => {
        if (!this.menu_manage) {
          this.menu_manage = new MenuManage();
        }

        this.menu_manage.show();
      });

    this.general_edit_button = frappe
      .jshtml({
        tag: 'div',
        properties: {
          class: 'btn-default button general-editor-button',
          style: 'display: none',
        },
        content: `<span class="fa fa-pencil"></span>`,
      })
      .on('click', () => {
        this.set_edit_status();
      });

    this.change_user_button = frappe
      .jshtml({
        tag: 'div',
        properties: {
          class: 'btn-default button',
          style:
            'display: flex; justify-content: center; align-items: center; padding-left: 10px; padding-right: 10px;',
        },
        content: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 14 14"><path fill="#dc2626" fill-rule="evenodd" d="M10.213 2.538A5.499 5.499 0 0 0 1.595 8.01a.75.75 0 0 1-1.474.277a6.999 6.999 0 0 1 11.163-6.821l.612-.612a.5.5 0 0 1 .854.353V3.5a.5.5 0 0 1-.5.5H9.957a.5.5 0 0 1-.353-.853zm2.791 2.577a.75.75 0 0 1 .876.598a6.999 6.999 0 0 1-11.164 6.821l-.612.613a.5.5 0 0 1-.854-.354V10.5a.5.5 0 0 1 .5-.5h2.293a.5.5 0 0 1 .354.854l-.61.609a5.499 5.499 0 0 0 8.618-5.472a.75.75 0 0 1 .6-.876ZM8.5 5.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0M7 7.525a3 3 0 0 0-2.517 1.367c-.188.29.05.633.395.633h4.244c.345 0 .583-.343.395-.633A3 3 0 0 0 7 7.525" clip-rule="evenodd"/></svg>`,
      })
      .on('click', () => {
        console.log('change user');
        this.change_user_button_action();
      });

    this.add_room_button = frappe
      .jshtml({
        tag: 'div',
        properties: {
          class: 'btn-default button general-editor-button add-room',
        },
        content: `<span class="fa fa-plus"></span>`,
      })
      .on('click', () => {
        this.add_object('Room');
      });

    this.setting_button = frappe
      .jshtml({
        tag: 'div',
        properties: {
          class: `btn-default button general-editor-button setting`,
          style: 'display: none',
        },
        content: '<span class="fa fa-gears"></span>',
      })
      .on('click', () => {});

    this.close_pos_button = frappe
      .jshtml({
        tag: 'a',
        content: ' (' + __('Close') + ' <span class="fa fa-sign-out"></span>)',
      })
      .on('click', () => {
        frappe.confirm('Close the POS?', function () {
          self.close_pos();
        });
      });

    this.pos_profile_description = frappe
      .jshtml({
        tag: 'span',
        properties: {
          class: 'pos-profile',
        },
        content: '{{text}}' + this.close_pos_button.html(),
        text: 'POS Profile',
      })
      .on('click', () => {
        frappe.confirm('Close the POS?', function () {
          self.close_pos();
        });
      });

    this.wrapper.append(`
			<div class="restaurant-manage">
				<div class="floor-selector">
					${this.general_edit_button.html()}
					${this.change_user_button.html()}
					${this.rooms_container.html()}
					${this.add_room_button.html()}
					${this.setting_button.html()}
				</div>
				<div class="floor-map">
					<div class="floor-map-editor left">
						${this.components.add_table.html()}
						${this.components.add_production_center.html()}
					</div>
					<div class="floor-map-reserve">
						${this.components.reservation.html()}
					</div>
					<div class="floor-map-editor right">
						${this.components.edit_room.html()}
						${this.components.delete_room.html()}
            ${this.components.menu_manage.html()}
					</div>
					${this.floor_map.html()}
				</div>
			</div>
			<div class="sidebar-footer">
				<div class="non-selectable">
					<span class="restaurant-manage-status">${__('Ready')}</span>
					${this.pos_profile_description.html()}
				</div>
			</div>
			<div id="customize-alert-message"></div>
		`);

    this.pull_alert('left');
  }

  close_pos() {
    this.working('Checking opening entries...');
    RM.pos.check_opening_entry(RM.pos_profile.name).then(() => {
      RM.ready();
      const voucher = frappe.model.get_new_doc('POS Closing Entry');
      voucher.pos_profile = this.pos.pos_profile;
      voucher.user = frappe.session.user;
      voucher.company = this.pos.company;
      voucher.pos_opening_entry = this.pos.pos_opening;
      voucher.period_end_date = frappe.datetime.now_datetime();
      voucher.posting_date = frappe.datetime.now_date();

      frappe.set_route('Form', 'POS Closing Entry', voucher.name);
    });
  }

  make_rooms() {
    const currents_rooms = Object.values(this.rooms || {}).map((room) => room.name);
    this.working('Loading Rooms');
    //this.clear_rooms(currents_rooms);

    return new Promise((res) => {
      frappe
        .call({
          method: `${this.url_manage}get_rooms`,
        })
        .then((r) => {
          this.rooms = r.message;
          this.clear_rooms(currents_rooms);
          this.render_rooms();
          this.ready();

          $('body').show();
          res();
        });
    });
  }

  call(method, args) {
    method = this.url_manage + method;
    this.working('Processing');
    return new Promise((res) => {
      frappe.call({ method, args }).then((r) => {
        r.message && this.ready(r.message);
        res(r.message);
      });
    });
  }

  clear_rooms(currents_rooms = []) {
    const keys_news = Object.values(this.rooms).map((t) => t.name);

    currents_rooms.forEach((key) => {
      if (!keys_news.includes(key)) {
        this.object(key) ? this.object(key).remove() : null;
        this.objects[key] && delete this.objects[key];
      }
    });
  }

  set_current_room(room) {
    this.current_room = room;
    this.test_components();
  }

  render_rooms(current = (window.crm_customer && this.pos_profile.crm_room) || false) {
    let room_from_url = null;

    this.rooms.forEach((room, index, rooms) => {
      const has_access_to_room = this.has_access_to_room(room.name);

      if (this.object(room.name) == null) {
        if (has_access_to_room) {
          this.object(room.name, new RestaurantRoom(room));
        }
      } else {
        if (!has_access_to_room) {
          this.object(room.name).remove();
        } else {
          this.object(room.name).data = room;
        }
      }

      if (current === false) {
        if (this.current_room == null) {
          if (this.object(this.room_from_url) == null) {
            room_from_url = rooms[0].name;
          } else {
            room_from_url = this.room_from_url;
          }
        } else {
          current = true;
          room_from_url = this.current_room.data.name;
        }
      } else {
        room_from_url = current;
      }
    });

    setTimeout(() => {
      this.current_room = this.object(room_from_url) || this.current_room;

      if (this.current_room != null) {
        if (this.has_access_to_room(this.current_room.data.name)) {
          this.current_room.select();
        } else {
          this.delete_current_room();
        }
      }
    }, 0);
  }

  has_access_to_room(room) {
    return (
      this.rooms_access.includes(room) ||
      frappe.session.user === 'Administrator' ||
      this.permissions.restaurant_object.create ||
      this.permissions.restaurant_object.write
    );
  }

  get settings_data() {
    return new Promise((res) => {
      frappe.xcall(`${this.url_manage}get_settings_data`, {}).then((r) => {
        this.set_settings_data(r);
        res();
      });
    });
  }

  set_settings_data(r) {
    this.loaded = true;
    this.#permissions = r.permissions;
    this.#exceptions = r.exceptions;
    this.#restrictions = r.restrictions;
    this.#lang = r.lang;
    this.restaurant_permissions = r.pos.restaurant_permissions;
    this.order_item_editor_form = r.order_item_editor_form;
    this.tax_template = r.tax_template;
    this.crm_settings = {};
    this.allows_to_edit_item = r.allows_to_edit_item.map((t) => t.name);
    this.has_pending_status = this.allows_to_edit_item.includes('Pending');
    this.menu = {
      name: r.menu,
      items: r.menu_items.map((i) => i.item),
      items_groups: r.items_groups,
      //categories: r.menu_categories,
      //menus: r.menus
    };

    if (!this.has_pending_status) {
      $('body').show();
      frappe.throw(
        __(
          "<strong>Restaurant need a status called 'Pending'</strong><br><br> Please create a status called 'Pending' in the Status Order PC and Allows To Edit Item"
        )
      );
    }

    Object.entries(r.crm_settings).forEach(([key, value]) => {
      this.crm_settings[key] = value[0] || null;
    });

    if (r.pos.has_pos) {
      this.#pos_profile = r.pos.pos;
      if (this.pos_profile != null) {
        this.pos_profile_description.val(this.pos_profile.name);
      }
    }

    this.ready();
  }

  get pos_profile() {
    return this.#pos_profile;
  }
  get permissions() {
    return this.#permissions;
  }
  get exceptions() {
    return this.#exceptions;
  }
  get restrictions() {
    return this.#restrictions;
  }
  get company() {
    return this.pos_profile.company;
  }
  get components() {
    return this.#components;
  }
  get lang() {
    return this.#lang;
  }

  in_rooms(f) {
    this.rooms.forEach((room, index, rooms) => {
      if (RM.object(room.name) != null) {
        f(RM.object(room.name), index, rooms);
      }
    });
  }

  object(name, object = null) {
    const obj = this.objects[name];
    if (typeof obj == 'undefined' && object != null) {
      this.objects[name] = object;
    }
    return typeof this.objects[name] != 'undefined' ? this.objects[name] : null;
  }

  init_synchronize() {
    frappe.realtime.on('debug', (data) => {
      console.log(data);
    });

    const check_items_in_process_manage = (items, item_removed = null) => {
      this.in_rooms((room) => {
        room.in_tables((table) => {
          if (table.process_manage != null) {
            table.process_manage.check_items(items);
            if (item_removed) {
              table.process_manage.remove_item(item_removed);
            }
          }
        });
      });
    };

    frappe.realtime.on('synchronize_order_data', (r) => {
      const data = r.data;
      const order = data.order;

      console.log('data synchronize_order_data', data);

      this.request_client = r.client;
      check_items_in_process_manage(data.items, r.item_removed);

      const table = RM.object(order.data.table);
      if (this.current_room == null || table == null) return;

      if (r.action === TRANSFER) {
        const last_table = RM.object(order.data.last_table);
        if (last_table != null && last_table.order_manage != null) {
          last_table.order_manage.check_data(r);
        }

        this.transfer_order = null;

        if (table.order_manage == null) {
          if (this.client === r.client) {
            setTimeout(() => {
              table.order_manage = new OrderManage({
                identifier: RM.OMName(table.data.name),
                table: table,
                current_order_identifier: order.data.name,
              });
              RM.object(table.order_manage.identifier, table.order_manage);
            });
          }
        } else {
          setTimeout(() => {
            table.order_manage.check_data(r);
            if (table.room.data.name === RM.current_room.data.name && RM.client === r.client) {
              table.order_manage.show();
            }
          });
        }
      } else {
        if (table.order_manage != null) {
          setTimeout(() => {
            table.order_manage.check_data(r);
          });
        }
      }
    });

    frappe.realtime.on('update_settings', () => {
      this.settings_data.then(() => {
        this.make_rooms();
        this.check_permissions_status();
      });
    });

    frappe.realtime.on('check_rooms', (r) => {
      this.rooms = r.rooms;

      this.settings_data.then(() => {
        this.rooms = this.rooms.filter(
          (room) => this.rooms_access.includes(room.name) || frappe.session.user === 'Administrator'
        );

        this.render_rooms(r.client === RM.client ? r.current_room : false);
      });
    });

    frappe.realtime.on('pos_profile_update', (r) => {
      if (r && r.has_pos) {
        this.#pos_profile = r.pos;
      } else {
        this.#pos_profile = null;
        this.raise_exception_for_pos_profile();
      }
    });

    frappe.realtime.on('update_menu', (r) => {
      const items = this.menu.items;
      r.in_menu ? !items.includes(r.item) && items.push(r.item) : (items = items.filter((i) => i !== r.item));

      this.menu.items = items;
    });
  }

  get rooms_access() {
    return Object.values((this.permissions || {}).rooms_access || []);
  }

  check_permissions_status() {
    this.in_rooms((Room) => {
      Room.in_tables((Table) => {
        if (Table.order_manage != null) {
          Table.order_manage.check_permissions_status();
        }
        Table.set_orders_count();
      }, 'Table');
    });

    if (!this.permissions.restaurant_object.write) {
      this.general_edit_button.disable().hide();
    } else {
      this.general_edit_button.enable().show();
    }
  }

  add_object(t) {
    if (t === 'Room') {
      this.add_room();
    } else if (this.current_room != null) {
      this.current_room.add_object(t);
    }
  }

  add_room() {
    this.working('Add Room');
    frappe.call({
      method: this.url_manage + 'add_room',
      args: { client: RM.client },
      always: () => {
        this.ready();
      },
    });
  }

  set_edit_status() {
    if (!this.permissions.restaurant_object.write) return;
    if (this.editing) {
      this.editing = false;
      $('.restaurant-manage').removeClass('editing');
      this.unselect_all_tables();
    } else {
      this.editing = true;
      $('.restaurant-manage').addClass('editing');
      Object.keys(this.components).forEach((k) => {
        this.#components[k].hide();
      });
      this.test_components();
    }
  }

  test_components() {
    Object.keys(this.components).forEach((k) => {
      if (this.current_room == null) {
        this.#components[k].hide();
      } else {
        this.#components[k].show();
      }
    });
  }

  async change_user_button_action() {
    let users_pos = [];

    try {
      const promises = this.pos_profile.applicable_for_users.map(async (user) => {
        const { message } = await frappe.db.get_value('User', user.user, ['full_name', 'user_image']);

        return {
          name: user.user,
          full_name: message.full_name,
          user_image: message.user_image,
        };
      });

      users_pos = await Promise.all(promises);
      console.log('users_pos', users_pos);

      this.show_user_selector(users_pos);
    } catch (error) {
      console.error('Error fetching user data:', error);
      frappe.throw(__('Error loading user data'));
    }
  }

  show_user_selector(users) {
    // Creamos el HTML para el menú de usuarios
    const userAvatarsHTML = `
    <div class="user-avatar-menu">
        <div class="menu-header">
            <h3 class="text-lg font-bold mb-4">Cambiar Usuario</h3>
            <button class="close-button">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="avatar-list">
            ${users
              .map(
                (user) => `
                <div class="avatar-item" data-user="${user.name}">
                    <div class="avatar-image">
                        ${
                          user.user_image
                            ? frappe.get_avatar(
                                'avatar-large', // clases CSS
                                user.full_name, // título
                                user.user_image, // imagen
                                ''
                              )
                            : `<div class="avatar-placeholder">${user.full_name.charAt(0)}</div>` // frappe.avatar(user.name, 'avatar-large')
                        }
                    </div>
                    <div class="avatar-name">${user.full_name}</div>
                </div>
            `
              )
              .join('')}
        </div>
    </div>
`;

    // Mostramos el menú
    frappe.dom.freeze(userAvatarsHTML, 'freeze-screen-change-user');

    // Estilizamos el contenedor
    const freezeArea = document.querySelector('.freeze-message-container');
    if (freezeArea) {
      freezeArea.style.setProperty('background-color', '#FFFFFF', 'important');
      freezeArea.style.setProperty('opacity', '1', 'important');
      freezeArea.style.setProperty('border-radius', '8px', 'important');
      freezeArea.style.setProperty('padding', '10px 10px', 'important');

      freezeArea.style.setProperty('position', 'fixed', 'important');
      freezeArea.style.setProperty('top', '50%', 'important');
      freezeArea.style.setProperty('left', '50%', 'important');
      freezeArea.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
      freezeArea.style.setProperty('max-height', '90vh', 'important');
      freezeArea.style.setProperty('overflow-y', 'auto', 'important');

      freezeArea.style.setProperty('width', 'auto', 'important');
      freezeArea.style.setProperty('min-width', '600px', 'important');
      freezeArea.style.setProperty('max-width', '90%', 'important');
      freezeArea.style.setProperty('max-height', '90%', 'important');
      freezeArea.style.setProperty('height', '40%', 'important');
    }

    const freezeContainer = document.querySelector('#freeze');
    if (freezeContainer) {
      freezeContainer.style.setProperty('opacity', '1', 'important');
      freezeContainer.style.setProperty('background-color', 'rgba(15, 23, 42, 0.9)', 'important');
      freezeContainer.style.setProperty('position', 'fixed', 'important');
      freezeContainer.style.setProperty('top', '0', 'important');
      freezeContainer.style.setProperty('left', '0', 'important');
      freezeContainer.style.setProperty('right', '0', 'important');
      freezeContainer.style.setProperty('bottom', '0', 'important');
    }

    // estilos para el cotenido
    const style = document.createElement('style');

    style.textContent = `
      .user-avatar-menu {
        text-align: center;
        padding: 10px;
        width: 100%;
      }

      .avatar-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 20px;
        padding: 15px 0;
        width: 100%;
      }

      .avatar-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        cursor: pointer;
        padding: 10px;
        border-radius: 8px;
        transition: all 0.3s ease;
        border: 2px solid #E5E7EB;
        width: 120px;
        margin: 0 auto;
        background-color: #f9f9f9;
      }

      .avatar-item:hover {
        background-color: #F3F4F6;
        transform: translateY(-2px);
      }

      .avatar-image {
        width: 70px;
        height: 70px;
        margin-bottom: 8px;
      }

      avatar-image img, .avatar-placeholder {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid #E5E7EB; // Agregado el borde a las imágenes
      }

      .avatar-placeholder {
        background-color: #E5E7EB;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: #6B7280;
      }
      .avatar-name {
        font-size: 14px;
        color: #374151;
        width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100px;
      }

      .menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        margin-bottom: 20px;
    }

    .close-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px;
        color: #6B7280;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }

    .close-button:hover {
        background-color: #F3F4F6;
        color: #374151;
    }

    .close-button svg {
        width: 20px;
        height: 20px;
    }

      @media (max-width: 768px) {
    .avatar-list {
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }

    .avatar-item {
      width: 100px;
    }

    .menu-header h3 {
      font-size: 16px;
    }
  }

    @media (max-width: 576px) {
    .avatar-list {
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .avatar-item {
      width: 90px;
      padding: 8px;
    }

    .avatar-image {
      width: 50px;
      height: 50px;
    }

    .avatar-name {
      font-size: 12px;
      max-width: 80px;
    }
  }

  @media (max-width: 360px) {
    .avatar-list {
      grid-template-columns: repeat(1, 1fr);
    }

    .avatar-item {
      width: 100%;
      max-width: 120px;
    }
  }
    `;

    document.head.appendChild(style);

    const adjustContainerWidth = () => {
      const freezeArea = document.querySelector('.freeze-message-container');
      if (freezeArea) {
        if (window.innerWidth <= 576) {
          // Mobile
          freezeArea.style.setProperty('width', '95%', 'important');
          freezeArea.style.setProperty('min-width', 'auto', 'important');
        } else if (window.innerWidth <= 768) {
          // Tablet
          freezeArea.style.setProperty('width', '80%', 'important');
          freezeArea.style.setProperty('min-width', '400px', 'important');
        } else {
          // Desktop
          freezeArea.style.setProperty('width', '580px', 'important');
          freezeArea.style.setProperty('min-width', '580px', 'important');
        }
      }
    };

    adjustContainerWidth();
    document.querySelector('.close-button').addEventListener('click', () => {
      frappe.dom.unfreeze();
    });

    window.addEventListener('resize', adjustContainerWidth);

    // Manejamos los clicks en los avatares
    document.querySelectorAll('.avatar-item').forEach((avatar) => {
      avatar.addEventListener('click', function () {
        const userId = this.getAttribute('data-user');

        console.log('userID', userId);

        if (userId === frappe.session.user) {
          return;
        }

        frappe
          .xcall('restaurant_management.api.impersonate', {
            user: userId,
            reason: '',
          })
          .then(() => window.location.reload());
      });
    });
  }

  get room_from_url() {
    return localStorage.getItem('restaurant_room') || this.current_room?.data?.name || null;
    ///return frappe.urllib.get_arg("restaurant_room");
  }

  unselect_all_tables() {
    this.in_rooms((room) => {
      room.unselect_all_tables();
    });
  }

  pull_alert(position = 'right', max_width = 'calc(100% - 410px)') {
    $('#customize-alert-message').empty().append(`
			<style>
				#alert-container{
					${position}: 10px !important;
					max-width: ${max_width} !important;
					-moz-user-select: none;
					-webkit-user-select: none;
					-ms-user-select: none;
					user-select: none;
					z-index: 999999999999999999999;
				}
			</style>`);
  }

  delete_current_room() {
    this.current_room = null;
    localStorage.removeItem('restaurant_room');
    //frappe.set_route(`/restaurant-manage?restaurant_room=?`);
    this.test_components();
  }

  working(text, busy = true) {
    this.busy = busy;
    this.wrapper.find('.restaurant-manage-status').empty().append(__(text));
  }

  ready(message = false, sound = false) {
    this.busy = false;
    if (RM.transfer_order != null) {
      this.working('Transferring Order');
    } else {
      this.wrapper.find('.restaurant-manage-status').empty().append(__('Ready'));
    }

    if (this.permanent_message) {
      this.working(this.permanent_message);
    } else {
      this.wrapper.find('.restaurant-manage-status').empty().append(__('Ready'));
    }

    if (message !== false) {
      frappe.show_alert(message);
    }

    if (sound !== false) {
      setTimeout(`window['RM'].sound_${sound}()`, 0);
    }
  }

  busy_message() {
    if (this.busy) {
      frappe.show_alert({
        indicator: 'red',
        message: __('Please wait for an operation to complete'),
      });
      return true;
    }
    return false;
  }

  notification(indicator = 'red', message = '') {
    frappe.show_alert({
      indicator: indicator,
      message: __(message),
    });
  }

  format_currency(value) {
    const val = isNaN(parseFloat(value)) ? 0 : parseFloat(value);
    return format_currency(parseFloat(val), this.pos_profile.currency);
  }

  sound_delete(message = false) {
    if (this.sounds) $('#sound-delete').trigger('play');
    if (message !== false) {
      frappe.show_alert(message);
    }
  }
  sound_submit(message = false) {
    if (this.sounds) $('#sound-submit').trigger('play');

    if (message !== false) {
      frappe.show_alert(message);
    }
  }
  sound_success(message = false) {
    if (this.sounds) $('#sound-submit').trigger('play');

    if (message !== false) {
      frappe.show_alert(message);
    }
  }

  uuid(prefix = 'obj') {
    const id = 'xxxx-xx-4xx-yxx-xxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    return prefix + '_' + id;
  }

  check_permissions(model = null, record = null, action) {
    if (frappe.session.user === 'Administrator') return true;

    let r = false;

    if (model != null) {
      let model_in_permissions = this.permissions[model];
      if (typeof model_in_permissions != 'undefined' && typeof model_in_permissions[action] !== 'undefined') {
        r = this.permissions[model][action];
      }

      const exception = () => {
        r = false;
        this.exceptions.map((e) => {
          r = e[model + '_' + action] === 1;
        });
      };

      if (record == null) {
        if (!r) {
          exception();
        }
      } else {
        if (record.data.owner !== frappe.session.user) {
          if (model === 'order' && this.restrictions.restricted_to_owner_order) {
            exception();
          }
          if (model === 'table' && this.restrictions.restricted_to_owner_table) {
            exception();
          }
        }
      }

      if (model === 'pos' && r) {
        r = this.pos_profile['allow_' + action] === 1;
      }
    }

    return r;
  }

  /*go_to_table(table, room){
    frappe.set_route(`restaurant-manage?restaurant_room=${room}`);
  }*/

  get can_pay() {
    return this.check_permissions('invoice', null, 'create');
  }

  can_open_order_manage(table) {
    if (frappe.session.user === 'Administrator' || this.can_pay) return true;

    if (table.data.current_user !== frappe.session.user && table.data.orders_count > 0) {
      if (this.restrictions.restricted_to_owner_table) {
        return this.check_permissions('order', null, 'manage');
      }
    }

    return true;
  }

  PMName(process_manage) {
    return 'process_manage' + process_manage;
  }
  OMName(order_manage) {
    return 'order_manage' + order_manage;
  }
};

/**
 * Módulo principal de gestión de restaurante
 * Maneja la interfaz y funcionalidad del punto de venta para restaurantes
 */

// Definición de variables globales
var RM = null; // Instancia principal del gestor de restaurante
// Constantes para diferentes tipos de acciones
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

// Proporciona el namespace para el punto de venta
frappe.provide('erpnext.PointOfSale');

// Inicialización de la página
frappe.pages['restaurant-manage'].on_page_load = function (wrapper) {
  // Configuración inicial de la página
  frappe.ui.make_app_page({
    parent: wrapper,
    title: '',
    single_column: true,
  });

  $('body').hide();

  // Verifica configuración del POS antes de inicializar
  frappe.db.get_value('POS Settings', { name: 'POS Settings' }, 'is_online', (r) => {
    if (r && !cint(r.use_pos_in_offline_mode)) {
      RM = new RestaurantManage(wrapper);
    }
  });
};

// Manejo de actualizaciones/refrescos de la página
frappe.pages['restaurant-manage'].refresh = function () {
  // Maneja la integración con CRM si hay un cliente
  if (window.crm_customer && RM) {
    RM.crm_customer = window.crm_customer;
    window.crm_customer = null;
    if (RM.objects[RM.crm_settings.crm_room]) {
      RM.objects[RM.crm_settings.crm_room].select();
    } else {
      frappe.throw(__('Please set a CRM Table in POS Profile, to create a new order from CRM'));
    }
  }

  // Maneja la navegación entre salas
  if (RM && RM.navigate_room) {
    const navigate = RM.navigate_room;
    RM.navigate_room = null;
    RM.objects[navigate].select();
  }
};

/**
 * Clase principal que maneja toda la funcionalidad del restaurante
 * Incluye gestión de mesas, órdenes, pagos y configuraciones
 */
RestaurantManage = class RestaurantManage {
  // Propiedades privadas
  #pos_profile = null; // Perfil del punto de venta
  #permissions = null; // Permisos del usuario
  #exceptions = null; // Excepciones a los permisos
  #restrictions = null; // Restricciones del sistema
  #company = null; // Empresa actual
  #components = []; // Componentes de la UI
  #lang = null; // Idioma actual
  #current_user = null; // Usuario actual

  // Propiedades públicas
  currency_precision = 2; // Precisión decimal para moneda
  editing = false; // Modo edición activo
  transfer_order = null; // Orden en transferencia
  current_room = null; // Sala actual
  busy = false; // Sistema ocupado
  sounds = false; // Sonidos activados
  client = this.uuid(); // ID único del cliente
  request_client = null; // Cliente que hace la petición
  loaded = false; // Sistema cargado
  store = {
    // Almacén de datos
    items: [],
  };
  objects = []; // Objetos del restaurante
  room = []; // Salas del restaurante

  /**
   * Constructor de la clase
   * @param {Object} wrapper - Contenedor principal de la UI
   */
  constructor(wrapper) {
    this.base_wrapper = wrapper;
    this.wrapper = $(wrapper).find('.layout-main-section');
    this.page = wrapper.page;
    this.url_manage = 'restaurant_management.restaurant_management.page.restaurant_manage.restaurant_manage.';
    this.#company = frappe.defaults.get_user_default('company');
    this.#current_user = frappe.session.user;

    // Lista de assets necesarios para el funcionamiento
    const assets = [
      // Assets JS
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

    // Carga los assets y luego inicializa
    frappe.require(assets, () => {
      this.make();
    });

    // Configura el manejo de cambios de tamaño de ventana
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

  /**
   * Maneja eventos de cambio de tamaño de ventana
   * @param {Function} fn - Función a ejecutar cuando cambie el tamaño
   */
  onResize(fn) {
    window.addEventListener('resize', () => {
      fn();
    });
    fn();
  }

  /**
   * Inicializa la aplicación
   * Ejecuta una serie de tareas en secuencia
   */
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

  /**
   * Verifica el estado del perfil POS
   * Lanza una excepción si no está configurado
   */
  test_pos() {
    if (this.loaded && this.pos_profile == null) {
      this.raise_exception_for_pos_profile();
    }
  }

  /**
   * Prepara el DOM inicial de la aplicación
   * Crea todos los componentes de la interfaz
   */
  prepare_dom() {
    const self = this;

    // Contenedor de salas
    this.rooms_container = frappe.jshtml({
      tag: 'div',
      properties: {
        style: 'display: flex; width: 100%',
      },
    });

    // Mapa del piso/sala
    this.floor_map = frappe
      .jshtml({
        tag: 'div',
        properties: { class: 'table-container-scroll' },
      })
      .on('click', () => {
        RM.unselect_all_tables();
      });

    // Botón para agregar mesa
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

    // Renderiza la estructura principal
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
      let url_manage = `restaurant_management.restaurant_management.page.restaurant_manage.restaurant_manage.get_settings_data`;
      console.log('url_manage --> ', url_manage);

      frappe.call({
        method: url_manage,
        args: {},
        callback: ({ message }) => {
          console.log('message --> ', message);
          this.set_settings_data(message);
          res();
        },
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

  /**
   * Inicializa la sincronización en tiempo real
   * Configura los eventos para mantener sincronizados los datos entre clientes
   */
  init_synchronize() {
    // Debug en tiempo real
    frappe.realtime.on('debug', (data) => {
      console.log(data);
    });

    /**
     * Verifica items en el gestor de procesos
     * @param {Array} items - Items a verificar
     * @param {Object} item_removed - Item eliminado si existe
     */
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

    // Sincronización de datos de órdenes
    frappe.realtime.on('synchronize_order_data', (r) => {
      const data = r.data;
      const order = data.order;

      this.request_client = r.client;
      check_items_in_process_manage(data.items, r.item_removed);

      const table = RM.object(order.data.table);
      if (this.current_room == null || table == null) return;

      // Manejo de transferencias
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

    // Actualización de configuraciones
    frappe.realtime.on('update_settings', () => {
      this.settings_data.then(() => {
        this.make_rooms();
        this.check_permissions_status();
      });
    });

    // Verificación de salas
    frappe.realtime.on('check_rooms', (r) => {
      this.rooms = r.rooms;

      this.settings_data.then(() => {
        // Filtra las salas según permisos
        this.rooms = this.rooms.filter(
          (room) => this.rooms_access.includes(room.name) || frappe.session.user === 'Administrator'
        );

        this.render_rooms(r.client === RM.client ? r.current_room : false);
      });
    });

    // Actualización del perfil POS
    frappe.realtime.on('pos_profile_update', (r) => {
      if (r && r.has_pos) {
        this.#pos_profile = r.pos;
      } else {
        this.#pos_profile = null;
        this.raise_exception_for_pos_profile();
      }
    });

    // Actualización del menú
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

  /**
   * Verifica los permisos del usuario actual
   * @param {string} model - Modelo a verificar
   * @param {Object} record - Registro específico a verificar
   * @param {string} action - Acción a verificar
   * @returns {boolean} - True si tiene permiso, false si no
   */
  check_permissions(model = null, record = null, action) {
    if (frappe.session.user === 'Administrator') return true;

    let r = false;

    if (model != null) {
      // Verifica permisos en el modelo
      let model_in_permissions = this.permissions[model];
      if (typeof model_in_permissions != 'undefined' && typeof model_in_permissions[action] !== 'undefined') {
        r = this.permissions[model][action];
      }

      // Verifica excepciones a los permisos
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
        // Verifica restricciones por propietario
        if (record.data.owner !== frappe.session.user) {
          if (model === 'order' && this.restrictions.restricted_to_owner_order) {
            exception();
          }
          if (model === 'table' && this.restrictions.restricted_to_owner_table) {
            exception();
          }
        }
      }

      // Verifica permisos específicos del POS
      if (model === 'pos' && r) {
        r = this.pos_profile['allow_' + action] === 1;
      }
    }

    return r;
  }

  /**
   * Verifica si el usuario puede realizar pagos
   * @returns {boolean}
   */
  get can_pay() {
    return this.check_permissions('invoice', null, 'create');
  }

  /**
   * Verifica si el usuario puede abrir el gestor de órdenes para una mesa
   * @param {Object} table - Mesa a verificar
   * @returns {boolean}
   */
  can_open_order_manage(table) {
    if (this.current_user === 'Administrator' || this.can_pay) return true;

    if (table.data.current_user !== this.current_user && table.data.orders_count > 0) {
      if (this.restrictions.restricted_to_owner_table) {
        return this.check_permissions('order', null, 'manage');
      }
    }

    return true;
  }

  /**
   * Reinicializa el estado de la aplicación
   * Se usa cuando cambia el usuario o se necesita refrescar todo
   * @private
   */
  async _reinitialize_app_state() {
    try {
      // Limpiamos el estado actual
      this.working('Reinicializando aplicación...');

      // Limpiamos las salas y objetos actuales
      this.clear_rooms(Object.keys(this.objects));
      this.current_room = null;

      // Limpiamos el controlador POS actual
      if (this.pos) {
        try {
          // Limpiamos los eventos y referencias del POS actual
          if (typeof this.pos.cleanup === 'function') {
            this.pos.cleanup();
          }

          // Removemos el contenedor del POS si existe
          const posContainer = this.wrapper.find('.point-of-sale-app');
          if (posContainer.length) {
            posContainer.remove();
          }

          // Limpiamos la referencia
          this.pos = null;
          window.cur_pos = null;
        } catch (error) {
          console.warn('Error al limpiar POS:', error);
        }
      }

      // Recargamos los datos de configuración
      try {
        await this.settings_data;
      } catch (error) {
        console.error('Error al cargar configuración:', error);
        throw new Error(__('Error al cargar la configuración del restaurante'));
      }

      // Reinicializamos el controlador POS
      try {
        this.pos = new erpnext.PointOfSale.RestaurantController(this.wrapper);
        window.cur_pos = this.pos;
      } catch (error) {
        console.error('Error al inicializar POS:', error);
        throw new Error(__('Error al inicializar el punto de venta'));
      }

      // Recargamos las salas y permisos
      try {
        await this.make_rooms();
        this.check_permissions_status();
      } catch (error) {
        console.error('Error al cargar salas:', error);
        throw new Error(__('Error al cargar las salas del restaurante'));
      }

      // Actualizamos el estado de los componentes
      this.test_components();

      this.ready();
    } catch (error) {
      console.error('Error al reinicializar la aplicación:', error);
      throw new Error(__('Error al reinicializar la aplicación: ') + error.message);
    }
  }

  /**
   * Cambia el usuario actual del sistema
   * Muestra un selector de usuarios y maneja el cambio
   */
  async change_user_button_action() {
    let users_pos = [];

    try {
      // Obtiene la información de los usuarios disponibles
      const promises = this.pos_profile.applicable_for_users.map(async (user) => {
        const { message } = await frappe.db.get_value('User', user.user, ['full_name', 'user_image']);

        return {
          name: user.user,
          full_name: message.full_name,
          user_image: message.user_image,
        };
      });

      users_pos = await Promise.all(promises);
      this.show_user_selector(users_pos);
    } catch (error) {
      console.error('Error fetching user data:', error);
      frappe.throw(__('Error cargando datos de usuarios'));
    }
  }

  /**
   * Maneja el cambio de usuario
   * @param {string} userId - ID del nuevo usuario
   * @private
   */
  async _handle_user_change(userId) {
    if (userId === this.current_user) return;

    // Mostramos el modal de PIN antes de continuar
    const pinVerified = await this._show_pin_verification_modal(userId);
    console.log('pinVerified', pinVerified);
    if (!pinVerified) return; // Si el PIN no es verificado, cancelamos el cambio

    frappe.dom.freeze(__('Cambiando usuario...'));

    try {
      // Llamamos al endpoint de cambio de usuario
      const impersonateResult = await frappe.xcall('restaurant_management.api.impersonate', {
        user: userId,
        reason: '',
      });

      if (!impersonateResult || impersonateResult.error) {
        throw new Error(impersonateResult?.error || __('Error al cambiar de usuario'));
      }

      // Actualizamos las cookies de sesión y datos del usuario
      try {
        const userData = await frappe.xcall('frappe.auth.get_logged_user');

        // Actualizamos los defaults del usuario si existen
        if (userData && userData.defaults) {
          frappe.defaults.update_user_defaults(userData.defaults);
        }
      } catch (error) {
        console.warn('Error al obtener datos del usuario:', error);
        // Continuamos aunque falle la obtención de datos del usuario
      }

      // Actualizamos el usuario global y local
      frappe.session.user = userId;
      this.set_current_user(userId);

      // Forzamos una recarga de los permisos del usuario
      try {
        await frappe.xcall('restaurant_management.api.get_user_permissions_erp', { user: userId });
      } catch (error) {
        console.warn('Error al recargar permisos:', error);
      }

      // Reinicializamos el estado
      await this._reinitialize_app_state();

      // Forzamos una actualización de la sesión
      try {
        await frappe.xcall('restaurant_management.api.get_session_info');
      } catch (error) {
        console.warn('Error al actualizar sesión:', error);
      }

      frappe.show_alert({
        message: __(`Usuario cambiado a ${userId}`),
        indicator: 'green',
      });
    } catch (error) {
      console.error('Error en cambio de usuario:', error);
      frappe.throw(__('Error al cambiar de usuario: ') + (error.message || __('Error desconocido')));
    } finally {
      frappe.dom.unfreeze();
    }
  }

  /**
   * Muestra un modal con un pad numérico para verificar el PIN del usuario
   * @param {string} userId - ID del usuario a verificar
   * @returns {Promise<boolean>} - Promesa que resuelve a true si el PIN es correcto
   * @private
   */
  _show_pin_verification_modal(userId) {
    return new Promise((resolve) => {
      // Primero creamos y agregamos los estilos para el pad numérico
      const pinPadStyleId = 'pin-pad-styles';
      if (!document.getElementById(pinPadStyleId)) {
        const styleSheet = document.createElement('style');
        styleSheet.id = pinPadStyleId;
        styleSheet.textContent = `
          .pin-verification-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
          }

          .pin-modal-content {
            background-color: #fff;
            border-radius: 12px;
            width: 360px;
            max-width: 90%;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            overflow: hidden;
          }

          .pin-modal-header {
            padding: 16px;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .pin-modal-header h3 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: #111827;
          }

          .pin-modal-body {
            padding: 24px;
          }

          .pin-display {
            display: flex;
            justify-content: center;
            margin-bottom: 24px;
          }

          .pin-digit {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: #e5e7eb;
            margin: 0 8px;
            transition: background-color 0.2s;
          }

          .pin-digit.filled {
            background-color: #4f46e5;
          }

          .pin-keypad {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
          }

          .pin-key {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            height: 60px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }

          .pin-key:hover {
            background-color: #f3f4f6;
            transform: translateY(-2px);
          }

          .pin-key:active {
            background-color: #e5e7eb;
            transform: translateY(0);
          }

          .pin-key.action {
            background-color: #f3f4f6;
            font-size: 16px;
          }

          .pin-key.clear {
            color: #ef4444;
          }

          .pin-key.enter {
            color: #10b981;
          }

          .pin-error {
            color: #ef4444;
            text-align: center;
            margin-top: 16px;
            font-size: 14px;
            height: 20px;
          }

          .pin-keyboard-hint {
            text-align: center;
            margin-top: 16px;
            font-size: 12px;
            color: #6b7280;
          }
        `;
        document.head.appendChild(styleSheet);
      }

      // Creamos el HTML para el modal de PIN
      const pinModalHTML = `
        <div class="pin-verification-modal">
          <div class="pin-modal-content">
            <div class="pin-modal-header">
              <h3>${__('Ingrese PIN')}</h3>
              <button class="close-button pin-close">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div class="pin-modal-body">
              <div class="pin-display">
                <div class="pin-digit" data-index="0"></div>
                <div class="pin-digit" data-index="1"></div>
                <div class="pin-digit" data-index="2"></div>
                <div class="pin-digit" data-index="3"></div>
              </div>
              <div class="pin-keypad">
                <div class="pin-key" data-key="1">1</div>
                <div class="pin-key" data-key="2">2</div>
                <div class="pin-key" data-key="3">3</div>
                <div class="pin-key" data-key="4">4</div>
                <div class="pin-key" data-key="5">5</div>
                <div class="pin-key" data-key="6">6</div>
                <div class="pin-key" data-key="7">7</div>
                <div class="pin-key" data-key="8">8</div>
                <div class="pin-key" data-key="9">9</div>
                <div class="pin-key action clear" data-key="clear">${__('Borrar')}</div>
                <div class="pin-key" data-key="0">0</div>
                <div class="pin-key action enter" data-key="enter">${__('Entrar')}</div>
              </div>
              <div class="pin-error"></div>
              <div class="pin-keyboard-hint">${__('También puede usar el teclado numérico')}</div>
            </div>
          </div>
        </div>
      `;

      // Agregamos el modal al DOM
      const pinModalContainer = document.createElement('div');
      pinModalContainer.id = 'pin-modal-container';
      pinModalContainer.innerHTML = pinModalHTML;
      document.body.appendChild(pinModalContainer);

      // Variables para manejar el PIN
      let currentPin = '';
      const maxPinLength = 4;
      const pinDigits = document.querySelectorAll('.pin-digit');
      const pinError = document.querySelector('.pin-error');

      // Función para actualizar la visualización del PIN
      const updatePinDisplay = () => {
        pinDigits.forEach((digit, index) => {
          if (index < currentPin.length) {
            digit.classList.add('filled');
          } else {
            digit.classList.remove('filled');
          }
        });
      };

      // Función para procesar la entrada de un dígito
      const processDigit = (digit) => {
        if (currentPin.length < maxPinLength) {
          currentPin += digit;
          pinError.textContent = '';
          updatePinDisplay();
        }
      };

      // Función para borrar el último dígito
      const clearLastDigit = () => {
        currentPin = currentPin.slice(0, -1);
        pinError.textContent = '';
        updatePinDisplay();
      };

      // Función para verificar el PIN
      const verifyPin = async () => {
        if (currentPin.length !== maxPinLength) {
          pinError.textContent = __('El PIN debe tener 4 dígitos');
          return;
        }

        try {
          // Se verifica el PIN con el servidor
          const result = await frappe.xcall('restaurant_management.api.verify_user_pin', {
            user: userId,
            pin: currentPin,
          });

          if (result && result.success) {
            // PIN correcto, cerramos el modal y continuamos con el cambio de usuario
            frappe.show_alert({
              message: __('PIN correcto'),
              indicator: 'green',
            });
            document.getElementById('pin-modal-container').remove();
            document.removeEventListener('keydown', handleKeyDown);
            resolve(true);
          } else {
            // PIN incorrecto
            frappe.show_alert({
              message: __('PIN incorrecto'),
              indicator: 'red',
            });
            pinError.textContent = __('PIN incorrecto');
            currentPin = '';
            updatePinDisplay();
          }
        } catch (error) {
          frappe.show_alert({
            message: __('Error al verificar PIN'),
            indicator: 'red',
          });
          console.error('Error al verificar PIN:', error);
          pinError.textContent = __('Error al verificar PIN');
          currentPin = '';
          updatePinDisplay();
        }
      };

      // Manejador de eventos para el teclado físico
      const handleKeyDown = (event) => {
        event.stopPropagation();

        const key = event.key;

        // Verificamos si es un número del 0-9
        if (/^[0-9]$/.test(key)) {
          processDigit(key);
        }
        // Tecla Enter para verificar
        else if (key === 'Enter') {
          verifyPin();
        }
        // Tecla Backspace o Delete para borrar los dígitos
        else if (key === 'Backspace' || key === 'Delete') {
          clearLastDigit();
        }
        // Tecla Escape para cerrar el modal
        else if (key === 'Escape') {
          document.getElementById('pin-modal-container').remove();
          document.removeEventListener('keydown', handleKeyDown);
          resolve(false);
        }
      };

      // Agregamos el listener para el teclado
      document.addEventListener('keydown', handleKeyDown);

      // Manejadores de eventos para el teclado numérico en pantalla
      document.querySelectorAll('.pin-key').forEach((key) => {
        key.addEventListener('click', () => {
          const keyValue = key.getAttribute('data-key');

          if (keyValue === 'clear') {
            clearLastDigit();
          } else if (keyValue === 'enter') {
            verifyPin();
          } else {
            processDigit(keyValue);
          }
        });
      });

      // Manejador para cerrar el modal
      document.querySelector('.pin-close').addEventListener('click', () => {
        document.getElementById('pin-modal-container').remove();
        document.removeEventListener('keydown', handleKeyDown);
        resolve(false);
      });

      // Enfocamos el modal para capturar eventos de teclado inmediatamente
      setTimeout(() => {
        const modalElement = document.querySelector('.pin-verification-modal');
        if (modalElement) {
          modalElement.focus();
        }
      }, 100);
    });
  }

  /**
   * Muestra el selector de usuarios
   * @param {Array} users - Lista de usuarios disponibles
   */
  show_user_selector(users) {
    // Primero creamos y agregamos los estilos
    const styleId = 'user-selector-styles';
    if (!document.getElementById(styleId)) {
      const styleSheet = document.createElement('style');
      styleSheet.id = styleId;
      styleSheet.textContent = `
        .user-avatar-menu {
          text-align: center;
          padding: 0;
          border: 2px solid #d1d5db;
          width: 100%;
          height: 100%;
          background-color:rgb(249, 249, 250);
          border-radius: 12px;
        }

        .avatar-list {
          display: grid;
          grid-template-columns: repeat(5, minmax(140px, 1fr));
          gap: 16px;
          padding: 24px;
          width: 100%;
          justify-content: center;
          align-items: center;
        }

        .avatar-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          cursor: pointer;
          padding: 16px;
          border-radius: 12px;
          transition: all 0.3s ease;
          border: 1px solid #E5E7EB;
          width: 140px;
          height: 160px;
          background-color: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .avatar-item:hover {
          background-color: #F3F4F6;
          transform: translateY(-2px);
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          border-color: #D1D5DB;
        }

        .avatar-image {
          width: 80px;
          height: 80px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background-color: #F3F4F6;
          overflow: hidden;
        }

        .avatar-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          color: #6B7280;
          font-weight: 500;
          background-color: #F3F4F6;
          border-radius: 50%;
        }

        .avatar-name {
          font-size: 14px;
          color: #374151;
          font-weight: 500;
          width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          padding: 0 8px;
          line-height: 1.4;
        }

        .menu-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 16px 16px;
          border-bottom: 1px solid #E5E7EB;
          background-color: #F9FAFB;
          border-radius: 12px;
          vertical-align: middle;
        }

        .menu-header h3 {
          font-size: 18px;
          color: #111827;
          font-weight: 600;
        }

        .close-button {
          padding: 8px;
          border-radius: 8px;
          border: none;
          background: transparent;
          cursor: pointer;
          color: #6B7280;
          transition: all 0.2s;
        }

        .close-button:hover {
          background-color:rgb(196, 196, 196);
          color: #374151;
        }

        .freeze-message-container {
          background: rgb(125, 125, 125) !important;
        }

        #freeze {
          background-color: rgb(11, 29, 74) !important;
          opacity: 1 !important;
        }
      `;
      document.head.appendChild(styleSheet);
    }

    // Creamos el HTML para el menú de usuarios
    const userAvatarsHTML = `
      <div class="user-avatar-menu">
        <div class="menu-header">
          <h3 class="text-lg font-bold">Cambiar Usuario</h3>
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
                    ? frappe.get_avatar('avatar-large', user.full_name, user.user_image, '')
                    : `<div class="avatar-placeholder">${user.full_name.charAt(0)}</div>`
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
    const freezeContainer = document.querySelector('#freeze');
    if (freezeContainer) {
      freezeContainer.style.setProperty('background-color', 'rgb(11, 29, 74)', 'important');
      freezeContainer.style.setProperty('opacity', '1', 'important');
      freezeContainer.style.setProperty('position', 'fixed', 'important');
      freezeContainer.style.setProperty('top', '0', 'important');
      freezeContainer.style.setProperty('left', '0', 'important');
      freezeContainer.style.setProperty('right', '0', 'important');
      freezeContainer.style.setProperty('bottom', '0', 'important');
    }

    // Modificamos el manejador de click en los avatares
    setTimeout(() => {
      document.querySelectorAll('.avatar-item').forEach((avatar) => {
        avatar.addEventListener('click', async () => {
          const userId = avatar.getAttribute('data-user');
          await this._handle_user_change(userId);
          frappe.dom.unfreeze(); // Quitamos el freeze del selector
        });
      });
    }, 0);
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

  PMName(process_manage) {
    return 'process_manage' + process_manage;
  }
  OMName(order_manage) {
    return 'order_manage' + order_manage;
  }

  // Getters y setters para el usuario actual
  get current_user() {
    return this.#current_user;
  }

  /**
   * Establece el usuario actual y emite evento de cambio
   * @param {string} user - ID del nuevo usuario
   */
  set_current_user(user) {
    this.#current_user = user;
    this.emit_user_change(user);
  }

  /**
   * Emite un evento de cambio de usuario
   * @param {string} user - ID del usuario que cambió
   */
  emit_user_change(user) {
    const event = new CustomEvent('rm_user_changed', {
      detail: {
        user: user,
        timestamp: new Date().getTime(),
      },
    });
    window.dispatchEvent(event);
  }

  /**
   * Suscribe una función al evento de cambio de usuario
   * @param {Function} callback - Función a ejecutar cuando cambie el usuario
   */
  subscribe_to_user_changes(callback) {
    window.addEventListener('rm_user_changed', (event) => {
      callback(event.detail);
    });
  }
};

frappe.provide('RM');

RM.ObjectManage = class ObjectManage {
  #children = {};

  constructor(options) {
    Object.assign(this, options);
  }

  append_child(opts) {
    const children = this.children;
    const child = opts.child || null;
    const not_exist_f = opts.not_exist || null;

    if (!child) return;

    if (this.has_child(child.name)) {
      opts.exist && opts.exist(children[child.name]);
    } else {
      if (not_exist_f) this.#children[child.name] = not_exist_f();
    }

    opts.always && opts.always(this.get_child(child.name));

    return this.get_child(child.name);
  }

  has_child(child) {
    const children = this.children;
    return Array.isArray(children) ? children.includes(child) : Object.keys(children).includes(child);
  }

  get children() {
    const children = this.#children;
    return children && typeof children == 'object' ? children : {};
  }

  set children(children) {
    this.#children = children;
  }

  get_child(child) {
    return this.has_child(child) ? this.children[child] : null;
  }

  in_child(f) {
    const children = this.children;
    let index = 0;

    if (Array.isArray(children)) {
      children.forEach((child, key) => {
        f(child, key, index);
        index++;
      });
    } else {
      Object.keys(children).forEach((key) => {
        f(children[key], key, index);
        index++;
      });
    }
  }

  delete_child(child) {
    if (this.has_child(child)) delete this.#children[child];
  }

  clear_children() {
    this.#children = {};
  }

  get child_count() {
    return Object.keys(this.children).length;
  }

  get child_names() {
    return Object.keys(this.children);
  }

  get child_values() {
    return Object.values(this.children);
  }

  get_child_by_name(name) {
    return this.get_child(name);
  }

  get_child_by_value(value) {
    let child = null;
    this.in_child((c, key) => {
      if (c == value) child = c;
    });
    return child;
  }

  get_child_by_index(index) {
    return this.child_values[index];
  }

  get_child_by_key(key) {
    return this.get_child(key);
  }

  get_child_by_keys(keys) {
    let child = this;
    keys.forEach((key) => {
      child = child.get_child_by_key(key);
    });
    return child;
  }

  get last_child() {
    return this.get_child_by_index(this.child_count - 1);
  }
};

// 2. Constantes globales
RM.DOUBLE_CLICK = 'dblclick';
RM.ADD = 'Add';
RM.DELETE = 'Delete';
RM.UPDATE = 'Update';

RM.FrappeForm = class FrappeForm extends frappe.ui.FieldGroup {
  background = false;
  buttons = {};
  button_label = 'Save';
  fetch_dict = {};

  constructor(opts) {
    super();
    this.fields = opts.fields;
    this.body = opts.body;
  }

  get_meta() {
    return this.#get('get_meta', { doctype: this.doctype });
  }

  async initialize() {
    this.form_name = this.desk_form ? this.desk_form.name : this.form_name;
    this.form_name = this.form_name.replaceAll(' ', '-').toLowerCase();

    if (!this.desk_form && !this.doc) {
      await this.get_all();
    }

    if (!this.desk_form) this.desk_form = await this.get_form();
    this.doctype = this.desk_form.doc_type;

    if (!this.doc && this.doc_name) this.doc = await this.get_doc();
    this.doc = JSON.parse(JSON.stringify(this.doc || {}));

    this.fields = this.desk_form.desk_form_fields;

    await this.make();
  }

  initialize_fetches() {
    this.desk_form.desk_form_fields.forEach((df) => {
      if (df.fetch_from) {
        this.trigger(df.fetch_from.split('.')[0], 'change');
      }
    });
  }

  async make() {
    const setup_add_fetch = (df_fetch_from, df_fetch_to, parent = null) => {
      df_fetch_from.listeners ??= {};
      df_fetch_from.listeners.change ??= [];

      df_fetch_from.listeners.change.push((e) => {
        if (parent) {
          const table_input = this.get_field(parent.fieldname).grid;
          const data = table_input.data;

          data.forEach((row, index) => {
            const row_input = table_input.get_row(index);
            const link_fetch = row_input.columns[df_fetch_from.fieldname].field;

            const target_fetch_inputs = Object.entries(df_fetch_to)
              .map(([key, _df_fetch_to]) => {
                return row_input.columns[_df_fetch_to.fieldname].field;
              })
              .reduce((acc, cur) => {
                if (cur) acc[cur.df.fieldname] = cur;
                return acc;
              }, {});

            this.fetch_link(link_fetch, target_fetch_inputs);
          });
        } else {
          const link_fetch = this.get_field(df_fetch_from.fieldname);

          const target_fetch_inputs = Object.entries(df_fetch_to)
            .map(([key, df_fetch_to]) => {
              return this.get_field(df_fetch_to.fieldname);
            })
            .reduce((acc, cur) => {
              if (cur) acc[cur.df.fieldname] = cur;
              return acc;
            }, {});

          this.fetch_link(link_fetch, target_fetch_inputs);
        }
      });

      setTimeout(() => {
        df_fetch_from.listeners.change.forEach((listener) => {
          this.on(df_fetch_from.fieldname, 'change', (e) => {
            listener(e);
          });
        });
      }, 0);
    };

    return new Promise((resolve) => {
      const fetches = {};

      const setup_fetch = (fields, df, parent = null) => {
        if (!df.fetch_from) return;

        const fetch_from = fields.find((field) => field.fieldname === df.fetch_from.split('.')[0]) || {};

        if (
          [
            'Data',
            'Read Only',
            'Text',
            'Small Text',
            'Currency',
            'Check',
            'Text Editor',
            'Code',
            'Link',
            'Float',
            'Int',
            'Date',
            'Select',
          ].includes(fetch_from.fieldtype) ||
          [true, 1, 'true', '1'].includes(fetch_from.read_only)
        ) {
          const fetch_from_field = fetch_from.fieldname;
          const fetch_to = df.fieldname;

          fetches[fetch_from_field] ??= {};
          fetches[fetch_from_field].fetch_from = fetch_from;
          fetches[fetch_from_field].fetch_to ??= [];
          fetches[fetch_from_field].fetch_to[fetch_to] = df;
          fetches[fetch_from_field].parent = parent;
        }
      };

      this.desk_form.desk_form_fields.forEach((df) => {
        setup_fetch(this.desk_form.desk_form_fields, df);

        const get_field_from_field_properties = (fieldname, parent = null) => {
          if (this.field_properties) {
            const field_props = this.field_properties[(parent ? parent + '.' : '') + fieldname];

            return field_props || {};
          }

          return {};
        };

        if (df.fieldtype === 'Table') {
          df.get_data = () => {
            return this.doc ? this.doc[df.fieldname] : [];
          };

          if (this.data.hasOwnProperty(df.fieldname)) {
            df.fields = this.data[df.fieldname];
          }

          (df.fields || []).forEach((f, index) => {
            if (f.fieldname === 'name') {
              //const x = myArray.splice(index, 1);
              //df.fields.splice(index, 1);
              // f.read_only = 1;
            } else {
              setup_fetch(df.fields, f, df);
              Object.assign(f, get_field_from_field_properties(f.fieldname, df.fieldname));
            }
          });

          df.options = null;
        } else {
          Object.assign(df, get_field_from_field_properties(df.fieldname));

          if (df.read_only) {
            df.doctype = null;
            df.docname = null;
          }
        }

        delete df.parent;
        delete df.parentfield;
        delete df.parenttype;
        delete df.doctype;
      });

      Object.values(fetches).forEach((fetch) => {
        setup_add_fetch(fetch.fetch_from, fetch.fetch_to, fetch.parent);
      });

      super.make();

      setTimeout(() => {
        this.after_load && this.after_load(this);
        this.initialize_fetches();
      }, 200);

      resolve();
    });
  }

  fetch_link(link_fetch, fetches_to = {}) {
    if (Object.keys(fetches_to).length === 0) return;

    const doctype = link_fetch.df.options;
    const from_cols = Object.values(fetches_to).map((fetch_to_df) => fetch_to_df.df.fetch_from.split('.')[1]);
    const doc_name = link_fetch.get_value();

    //if (link_fetch.last_value === doc_name) return;
    link_fetch.last_value = doc_name;

    frappe.call({
      method: 'restaurant_management.api.validate_link',
      type: 'GET',
      args: {
        value: doc_name,
        options: doctype,
        fetch: from_cols.join(','),
      },
      no_spinner: true,
      callback: (r) => {
        const fetch_values = r.fetch_values || [];
        Object.values(fetches_to).map((fetch_to_df, index) =>
          fetch_to_df.set_value(r.message == 'Ok' ? fetch_values[index] : '')
        );
      },
    });
  }

  refresh() {
    super.refresh(this.doc);

    this.refresh_fields();
    this.on_refresh && this.on_refresh();
  }

  refresh_fields() {
    const listeners = Object.assign({}, this.listeners || {});
    this.listeners = {};

    this.desk_form.desk_form_fields.forEach((df) => {
      if (df.read_only) {
        df.doctype = null;
        df.docname = null;

        this.set_field_property(df.fieldname, 'read_only', true);
      }

      if (listeners[df.fieldname]) {
        this.set_df_property(df.fieldname, 'listeners', {});

        Object.entries(listeners[df.fieldname]).forEach(([event, callback]) => {
          this.set_df_property(df.fieldname, 'on' + event, []);
          callback.forEach((cb) => {
            this.on(df.fieldname, event, cb);
          });
        });
      }
    });
  }

  async get_doc(from_server = false) {
    if (this.doc && !from_server) return this.doc;
    const data = await this.#get('get_doc', { doctype: this.doctype, doc_name: this.doc_name });

    return data;
  }

  async get_form() {
    const data = await this.#get('get_form', { form_name: this.form_name });

    return data.desk_form;
  }

  async get_all() {
    this.data = await this.#get('get_form_data', { form_name: this.form_name, doc_name: this.doc_name });

    this.doc = this.data.doc;
    this.desk_form = this.data.desk_form;
  }

  async #get(method, args) {
    return new Promise((resolve) => {
      frappe
        .call({
          method: `restaurant_management.restaurant_management.doctype.desk_form.desk_form.${method}`,
          args: args,
          freeze: this.background === false,
        })
        .then((r) => {
          return resolve(r.message);
        });
    });
  }

  set_field_property(field_name, property, value) {
    if (Array.isArray(field_name)) {
      field_name.forEach((field) => {
        this.set_field_property(field, property, value);
      });
      return;
    }

    if (typeof property === 'object') {
      Object.keys(property).forEach((key) => {
        this.set_field_property(field_name, key, property[key]);
      });
      return;
    }

    const field = this.get_field(field_name);
    field.doctype = field.df.doctype;
    field.docname = field.df.docname;

    this.set_df_property(field_name, property, value);
  }

  get_fields() {
    return this.fields_dict;
  }

  get_section(section_name) {
    return this.get_field(section_name);
  }

  on(fieldname, event, fn) {
    if (Array.isArray(fieldname)) {
      fieldname.forEach((f) => this.on(f, event, fn));
      return;
    }

    const field = this.get_field(fieldname);

    if (field && field.df) {
      const df = field.df;

      df.listeners ??= {};
      df.listeners[event] ??= [];
      df.listeners[event].push(fn);

      this.listeners ??= {};
      this.listeners[df.fieldname] ??= {};
      this.listeners[df.fieldname][event] ??= [];
      this.listeners[df.fieldname][event].push(fn);

      df[`on${event}`] = () => {
        //if(this.reloading) return;
        df.listeners[event].forEach((fn) => {
          fn(field, fieldname);
        });
      };
    }
  }

  trigger(fieldname, event) {
    if (Array.isArray(fieldname)) {
      fieldname.forEach((f) => this.trigger(f, event));
      return;
    }
    const field = this.get_field(fieldname);
    const e = field && field.df[`on${event}`];

    e && typeof e === 'function' && e(this.get_value(fieldname));
  }

  execute_event(fieldname, event) {
    const field = this.get_field(fieldname);

    if (field && field.df) {
      const df = field.df;
      df.listeners ??= {};
      df.listeners[event] ??= [];
      df.listeners[event].push(fn);

      df[`on${event}`] = () => {
        df.listeners[event].forEach((fn) => {
          fn(this.get_value(fieldname));
        });
      };
    }
  }

  save(options = {}, force = false) {
    // validation hack: get_values will check for missing data
    return new Promise((resolve) => {
      setTimeout(() => {
        const doc_values = super.get_values(force);

        if (!doc_values) {
          options.error && options.error(false);
          return;
        }

        if (window.saving) {
          options.error && options.error(__('Please wait for the other operation to complete'));
          return;
        }

        Object.assign(this.doc, doc_values || {});
        this.doc.doctype = this.doctype;

        window.saving = true;
        frappe.form_dirty = false;

        frappe.call({
          type: 'POST',
          method: this.base_url + 'accept',
          args: {
            desk_form: this.form_name,
            data: this.doc,
            doc_name: this.doc_name,
          },
          freeze: true,
          btn: this.buttons[this.button_label],
          callback: (data) => {
            if (!data.exc) {
              this.doc_name = data.message.name;

              this.callback && this.callback(this);
              this.on_save && this.on_save(data);
              options.success && options.success(data);
            } else {
              options.error && options.error(__('There were errors. Please report this.'));
            }

            options.always && options.always(data);
          },
          always: (r) => {
            options.always && options.always(r);
            window.saving = false;
          },
          error: function (r) {
            options.always && options.always(r);
            options.error && options.error(__('There were errors. Please report this.'));
          },
        });
      }, 200);
    });
  }

  refresh_dependency() {
    super.refresh_dependency();

    if (this.reloading) return;

    this.on_refresh_dependency && this.on_refresh_dependency(this);
  }
};

RM.JSHtml = class JSHtml {
  #obj = null;
  #disabled = false;
  #cursor_position = 0;
  #click_attempts = 0;
  #confirming = false;
  #jshtml_identifier = 'jstmlefc65a6efc9cb8afbc85';
  #$ = null;
  #properties = {};
  #identifier = this.uuid();
  #listeners = {};
  #content = undefined;
  #text = undefined;
  #value = undefined;
  #is_float = false;
  #is_int = false;
  #decimals = 2;

  constructor(options) {
    Object.assign(this, options);

    this.#properties = typeof options.properties == 'undefined' ? {} : options.properties;
    this.fusion_props();
    this.make();
    this.set_obj();
    this.default_listeners();
    this.pad_editing = false;

    return this;
  }

  set properties(val) {
    this.#properties = val;
  }
  set content(val) {
    this.#content = val;
  }
  set text(val) {
    this.#text = val;
  }
  set cursor_position(val) {
    this.#cursor_position = val;
    if (this.#cursor_position < 0) this.#cursor_position = 0;
  }

  get obj() {
    return this.#obj;
  }
  get disabled() {
    return this.#disabled;
  }
  get cursor_position() {
    return this.#cursor_position;
  }
  get click_attempts() {
    return this.#click_attempts;
  }
  get confirming() {
    return this.#confirming;
  }
  get jshtml_identifier() {
    return this.#jshtml_identifier;
  }
  get $() {
    return this.#$;
  }
  get identifier() {
    return this.#identifier;
  }
  get properties() {
    return this.#properties;
  }
  get listeners() {
    return this.#listeners;
  }
  get float_val() {
    return isNaN(parseFloat(this.val())) ? 0.0 : parseFloat(this.val());
  }
  get int_val() {
    return parseInt(isNaN(this.val()) ? 0 : this.val());
  }
  get content() {
    return this.#content;
  }
  get text() {
    return this.#text;
  }

  set_obj() {
    if (this.obj) return;
    setTimeout(() => {
      this.#obj = this.from_html
        ? this.from_html
        : document.querySelector(`${this.tag}[${this.identifier}='${this.identifier}']`);
      setTimeout(() => {
        if (this.obj != null) this.#obj.removeAttribute(this.identifier);
      }, 0);
      this.#$ = this.JQ();
    }, 0);
  }

  fusion_props() {
    this.#properties[this.identifier] = this.identifier;
  }

  get type() {
    let type = null;
    ['input', 'button', 'select', 'check', 'radio'].forEach((t) => {
      if (t === this.tag) type = t;
    });

    return type;
  }

  make() {
    this.make_dom();
  }

  toggle_common(base_class, toggle_class) {
    setTimeout(() => {
      this.add_class(toggle_class).JQ().siblings(`.${base_class}.${toggle_class}`).removeClass(toggle_class);
    }, 0);
  }

  float(decimals = 2) {
    this.#is_float = true;
    this.is_editable = true;
    this.#decimals = decimals;
    if (this.type === 'input') {
      this.setInputFilter((value) => {
        return /^-?\d*[.,]?\d*$/.test(value);
      });
    }
    return this;
  }

  int() {
    this.#is_int = true;
    this.is_editable = true;
    if (this.type === 'input') {
      this.setInputFilter((value) => {
        return /^-?\d*$/.test(value);
      });
    }
    return this;
  }

  on(listener, fn, method = null, callBack = null) {
    if (typeof listener == 'object') {
      for (let listen in listener) {
        if (!listener.hasOwnProperty(listen)) continue;
        this.set_listener(listener[listen], fn);
      }
    } else {
      this.set_listener(listener, fn, method, callBack);
    }
    return this;
  }

  on_listener(fn, listener) {
    Object.keys(this.listeners[listener]).forEach((f) => {
      fn(this.listeners[listener][f]);
    });
  }

  set_listener(listener, fn, method = null, callBack = null) {
    if (typeof this.listeners[listener] == 'object') {
      this.#listeners[listener].push(fn);
    } else {
      this.#listeners[listener] = [fn];
    }

    setTimeout(() => {
      if (this.obj == null) return;

      this.on_listener(
        (listen) => {
          this.obj.addEventListener(listener, (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.is_disabled) return;

            if (method != null && method === 'double_click') {
              if (this.click_attempts === 0) {
                this.#confirming = true;
                if (typeof this.text != 'undefined' && this.text.length > 0) {
                  this.val(__('Confirm'));
                }
                this.#click_attempts = 1;
                this.add_class(`${this.jshtml_identifier}-confirm`)
                  .JQ()
                  .delay(5000)
                  .queue((next) => {
                    if (this.confirming) {
                      this.reset_confirm();
                      next();
                    }
                  });
              } else {
                this.reset_confirm();
                listen(this, this.obj, event, callBack);
              }
            } else {
              listen(this, this.obj, event, callBack);
            }
          });
        },
        listener,
        fn
      );
    }, 10);
  }

  set_content(content) {
    this.content = content;
    this.val('');
    return this;
  }

  make_dom() {
    //setTimeout(() => {
    if (!this.wrapper) {
      return this.html();
    } else {
      $(this.wrapper).append(this.html());
    }
    //}, 0);
  }

  html() {
    let template = this.template();
    this.set_obj();
    return template.replace('{{content_rendered}}', this.get_content_rendered());
  }

  refresh() {
    this.content = this.get_content_rendered();
    return this;
  }

  reset_confirm() {
    this.#confirming = false;
    this.#click_attempts = 0;
    this.remove_class(`${this.jshtml_identifier}-confirm`);
    this.val(this.text);

    return this;
  }

  get_content_rendered(text = null) {
    let _text = this.confirming ? __('Confirm') : this.text;
    if (typeof this.content != 'undefined') {
      if (typeof _text != 'undefined') {
        if (this.content.toString().search('{{text}}') === -1) {
          this.content = _text;
          return this.content;
        } else {
          return this.content.toString().replace('{{text}}', text || _text);
        }
      } else {
        if (text) {
          this.content = text;
        }
        return this.content;
      }
    } else {
      return '';
    }
  }

  template() {
    return `<${this.tag} ${this.props_by_json(this.properties)}>{{content_rendered}}</${this.tag}>`;
  }

  set_selection() {
    if (this.type === 'input') {
      this.cursor_position = this.obj.selectionStart;
    } else {
      if (this.is_int || this.is_float) {
        if (!isNaN(parseFloat(this.value))) {
          this.in_decimal = false;
          this.cursor_position = parseInt(this.val()).toString().length;
        }
      } else {
        this.#cursor_position = this.val().toString().length;
      }
    }
  }

  default_listeners() {
    setTimeout(() => {
      if (this.is_editable) {
        this.on(['click', 'onkeydown', 'onkeypress'], (jshtml, obj, event) => {
          this.set_selection();
        });

        this.on('change', (jshtml) => {
          if (jshtml && !jshtml.pad_editing) this.value = this.type == 'input' ? this.JQ().val() : this.JQ().html();
        });
      }
    }, 0);
  }

  name() {
    return this.get_attr('name');
  }

  get_attr(attr = '') {
    return this.obj.getAttribute(attr);
  }

  find(selector) {
    return this.JQ().find(selector);
  }

  enable(on_enable = true) {
    this.#disabled = false;
    setTimeout(() => {
      if (on_enable) {
        this.prop('disabled', false);
      }
      this.remove_class(this.jshtml_identifier);
    }, 0);

    return this;
  }

  disable(on_disable = true) {
    this.#disabled = true;
    setTimeout(() => {
      if (on_disable) {
        this.prop('disabled', true);
      }
      this.add_class(this.jshtml_identifier);
    }, 0);

    return this;
  }

  css(prop = '', val = '') {
    setTimeout(() => {
      if (this.obj) {
        if (typeof prop == 'object') {
          prop.forEach((row) => {
            this.obj.style[row.prop] = row.value;
          });
        } else {
          this.obj.style[prop] = val;
        }
      }
    }, 0);

    return this;
  }

  add_class(class_name) {
    if (typeof class_name == 'object') {
      for (let c in class_name) {
        if (!class_name.hasOwnProperty(c)) continue;
        this.JQ().addClass(c);
      }
    } else {
      this.JQ().addClass(class_name);
    }

    return this;
  }

  has_class(class_name) {
    return this.obj && this.obj.classList.contains(class_name);
  }

  has_classes(classes) {
    let has_class = false;
    for (let c in classes) {
      if (!classes.hasOwnProperty(c)) continue;
      if (this.has_class(classes[c])) has_class = true;
    }
    return has_class;
  }

  JQ() {
    return $(this.obj);
  }

  select() {
    setTimeout(() => {
      this.obj.select();
    }, 0);

    return this;
  }

  remove_class(class_name) {
    if (typeof class_name == 'object') {
      for (let c in class_name) {
        if (!class_name.hasOwnProperty(c)) continue;
        this.JQ().removeClass(c);
      }
    } else {
      this.JQ().removeClass(class_name);
    }
    return this;
  }

  get is_disabled() {
    return this.disabled;
  }

  delete_selection(value, move_position = 1) {
    let current_value = this.val().toString();
    let current_selection = window.getSelection().toString();

    this.cursor_position = current_value.search(current_selection) + move_position;

    this.val(current_value.replace(current_selection, value));
  }

  has_selection() {
    return window.window.getSelection().toString().length;
  }

  write(value) {
    if (this.is_disabled) return;

    value = value.toString();
    if (this.has_selection()) {
      this.delete_selection(value);
      return;
    }

    let raw_value = this.type != 'input' ? this.raw_value : this.val();
    let editable_value = raw_value;
    let decimal_value = 0;

    if (raw_value.toString().length === 0) this.cursor_position = 0;

    if (this.is_float && this.type != 'input') {
      if (value === '.') {
        this.in_decimal = true;
        return;
      }

      if (!isNaN(parseFloat(raw_value))) {
        decimal_value = raw_value.toString().split('.')[1];
        decimal_value =
          typeof decimal_value != 'undefined' && !isNaN(parseInt(decimal_value))
            ? parseInt(decimal_value).toString()
            : '';
        raw_value = parseInt(raw_value).toString();
        editable_value = raw_value;
      }
    }

    if (this.in_decimal) {
      if (this.cursor_position >= this.val().toString().length && this.val().toString().length > 0) return;

      if (this.cursor_position == 0) {
        if (decimal_value.toString().length > 1) {
          decimal_value = '';
        } else {
          this.cursor_position = decimal_value.toString().length;
        }
      }
      editable_value = decimal_value;
    }

    let left_value = editable_value.toString().substring(0, this.cursor_position).toString();
    let right_value = editable_value.toString().substring(this.cursor_position, editable_value.length).toString();

    let new_vslue = '';
    if (this.type != 'input') {
      if (this.in_decimal) {
        new_vslue = `${raw_value}.${left_value}${value}${right_value}`;
      } else {
        new_vslue = `${left_value}${value}${parseInt(right_value) > 0 ? right_value : ''}${
          decimal_value > 0 ? '.' + decimal_value : ''
        }`;
      }
    } else {
      new_vslue = `${left_value}${value}${right_value}`;
    }

    this.pad_editing = true;

    this.val(new_vslue);

    this.cursor_position = this.cursor_position + 1;

    if (this.in_decimal && this.cursor_position > this.#decimals) {
      this.cursor_position = this.raw_value.toString().length;
    }

    if (this.raw_value.toString().length == 0) this.in_decimal = false;

    this.trigger('change');
    this.pad_editing = false;
  }

  plus(value = 1) {
    this.val(this.float_val + value);
    this.focus();

    return this;
  }

  minus(value = 1) {
    if (this.float_val > 0) {
      this.val(this.float_val - value);
      this.focus();

      return this;
    }
  }

  get is_int() {
    return typeof this.#is_int == 'undefined' ? false : this.#is_int;
  }
  get is_float() {
    return typeof this.#is_float == 'undefined' ? false : this.#is_float;
  }

  get value() {
    return this.#value;
  }

  get raw_value() {
    if (this.is_float || this.is_int) {
      return isNaN(parseFloat(this.value)) ? '' : parseFloat(this.value).toString();
    } else {
      return this.value.toString();
    }
  }

  set value(val) {
    if (this.is_float) {
      this.#value = parseFloat(val).toFixed(2);
      if (isNaN(this.#value)) this.#value = '';
    } else if (this.is_int) {
      this.#value = parseInt(val);
      if (isNaN(this.#value)) this.#value = '';
    } else {
      this.#value = val;
    }
  }

  val(val = null, change = true, filter = false) {
    if (val == null) {
      if (typeof this.value == 'undefined') {
        this.value = this.type == 'input' ? this.JQ().val() : this.JQ().html();
      }
      return this.value;
    } else {
      this.value = val;

      if (!filter && this.properties.input_type === 'number') {
        if (this.value.toString().length > 0) {
          this.filter_number();
        }
      }
      if (!this.#confirming) this.text = this.value;

      setTimeout(() => {
        if (this.type === 'input') {
          this.JQ().val(this.value);
          if (change) this.trigger('change');
        } else {
          this.empty().JQ().html(this.get_content_rendered(this.value));
        }
      }, 0);

      return this;
    }
  }

  prepend(content) {
    this.JQ().prepend(content);
    return this;
  }

  append(content) {
    this.JQ().append(content);
    return this;
  }

  empty() {
    this.JQ().empty();
    return this;
  }

  remove() {
    this.JQ().remove();
  }

  hide() {
    this.add_class('hide');
    this.css('display', 'none !important');
    return this;
  }

  show() {
    this.remove_class('hide');
    this.css('display', '');
    return this;
  }

  prop(prop, value = '') {
    if (typeof prop == 'object') {
      for (let p in prop) {
        if (!prop.hasOwnProperty(p)) continue;

        if (p === 'disabled') {
          if (prop[p]) {
            this.disable(false);
          } else {
            this.enable(false);
          }
        }
        this.JQ().prop(p, prop[p]);
      }
    } else {
      if (prop === 'disabled') {
        if (value) {
          this.disable(false);
        } else {
          this.enable(false);
        }
      }

      this.JQ().prop(prop, value);
    }
    return this;
  }

  check_changes(last_val) {
    setTimeout(() => {
      let save_cursor_position = this.cursor_position;
      if (this.val() !== last_val) {
        this.trigger('change');
      }

      this.cursor_position = save_cursor_position;
      this.focus();
    }, 0);
  }

  delete_value() {
    if (this.is_disabled) return;
    let raw_value = this.raw_value;

    if (raw_value.toString().length == 0) return;

    if (this.has_selection()) {
      this.delete_selection('', 0);
      return;
    }

    let new_value = '';

    let left_value = raw_value.substring(0, this.cursor_position);
    let right_value = raw_value.substring(this.cursor_position, raw_value.length);

    if (this.cursor_position === raw_value.length) {
      new_value = left_value.substring(0, raw_value.length - 1);
      this.cursor_position = this.cursor_position - 1;
    } else {
      new_value = left_value.substring(0, this.cursor_position - 1) + right_value;
      this.cursor_position = this.cursor_position - 1;
    }

    if (this.cursor_position === 0 && raw_value.length > 0) {
      this.cursor_position = raw_value.length;
    }

    if (new_value.toString().length == 0) {
      this.in_decimal = false;
    }
    this.val(new_value);
  }

  trigger(event) {
    if (typeof this.listeners[event] != 'undefined') {
      for (let listen in this.listeners[event]) {
        if (this.listeners[event].hasOwnProperty(listen)) {
          this.listeners[event][listen]();
        }
      }
    }
    this.focus();
  }

  focus() {
    //this.cursor_position = this.cursor_position < 0 ? 0 : this.cursor_position;
    this.JQ().focus();
    let pos = this.cursor_position;

    this.JQ().each(function (index, elem) {
      if (elem.setSelectionRange) {
        elem.setSelectionRange(pos, pos);
      } else if (elem.createTextRange) {
        let range = elem.createTextRange();
        range.moveEnd('character', pos);
        range.moveStart('character', pos);
        range.select();
      }
    });
  }

  setInputFilter(inputFilter) {
    setTimeout(() => {
      ['input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'select', 'contextmenu', 'drop'].forEach((event) => {
        this.#obj.addEventListener(event, function () {
          if (inputFilter(this.value)) {
            this.oldValue = this.value;
            this.oldSelectionStart = this.selectionStart;
            this.oldSelectionEnd = this.selectionEnd;
          } else if (this.hasOwnProperty('oldValue')) {
            this.value = this.oldValue;
            this.setSelectionRange(this.oldSelectionStart, this.oldSelectionEnd);
          } else {
            this.value = '';
          }
        });
      });
    });
  }

  filter_number() {
    let inputFilter = (value) => {
      return /^-?\d*[.,]?\d*$/.test(value);
    };

    if (inputFilter(this.val())) {
      this.oldValue = this.val();
      this.oldSelectionStart = this.selectionStart;
      this.oldSelectionEnd = this.selectionEnd;
    } else if (this.hasOwnProperty('oldValue')) {
      this.value = this.oldValue;
      if (this.type === 'inpunt') {
        this.setSelectionRange(this.oldSelectionStart, this.oldSelectionEnd);
      }
    } else {
      this.value = '';
    }
  }

  props_by_json(props = {}) {
    let _html = '';
    for (let prop in props) {
      if (!props.hasOwnProperty(prop)) continue;
      _html += `${prop}='${props[prop]}'`;
    }
    return _html;
  }

  uuid() {
    let id = 'xxxxxxxx4xxxyxxxxxxx'.replace(/[xy]/g, function (c) {
      let r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    return 'jshtml' + id;
  }

  highlight() {
    this.add_class(`${this.jshtml_identifier}-confirm`)
      .JQ()
      .delay(10000)
      .queue((next) => {
        this.remove_class(`${this.jshtml_identifier}-confirm`);
        next();
      });
  }
};

frappe.jshtml = (options) => {
  return new JSHtml(options);
};

RM.DeskForm = class DeskForm extends RM.FrappeForm {
  is_hide = true;
  has_footer = true;
  has_primary_action = true;
  base_url = 'restaurant_management.restaurant_management.doctype.desk_form.desk_form.';

  constructor(options) {
    super(options);

    this.in_modal = !this.location;
    if (this.form_name) this.initialize();
  }

  remove() {
    this.$$wrapper.remove();
  }

  get $$wrapper() {
    return this.in_modal ? $(this._wrapper.$wrapper) : this._wrapper;
  }

  get parent() {
    return this.body;
  }

  get body() {
    return this.in_modal ? $(this._wrapper.$wrapper).find('.modal-body') : this._wrapper;
  }

  get footer() {
    return this.in_modal ? $(this._wrapper.$wrapper).find('.modal-footer') : this.body;
  }

  get footer_buttons_wrapper() {
    return this.footer.find('.standard-actions');
  }

  get primary_btn() {
    return this.footer.find('.btn-primary');
  }

  get_primary_btn() {
    return this.primary_btn;
  }

  field(field_name) {
    return this.in_modal ? this._wrapper.fields_dict[field_name].$wrapper : null;
  }

  get_value(fieldname) {
    if (Array.isArray(fieldname)) {
      const values = [];
      fieldname.forEach((field) => {
        values.push(this.get_value(field));
      });
      return values;
    }

    return super.get_value(fieldname);
  }

  async initialize() {
    if (this.location) {
      this.location.append(`<div class="desk-form"></div>`);
      this._wrapper = this.location.find('.desk-form');
    } else {
      this._wrapper = new frappe.ui.Dialog({
        title: this.title,
        on_hide: () => {
          close_grid_and_dialog();
        },
      });
    }

    await super.initialize();

    function close_grid_and_dialog() {
      // close open grid row
      var open_row = $('.grid-row-open');
      if (open_row.length) {
        var grid_row = open_row.data('grid_row');
        grid_row.toggle_view(false);
        return false;
      }

      // close open dialog
      if (cur_dialog && !cur_dialog.no_cancel_flag) {
        //cur_dialog.cancel();
        return false;
      }
    }

    this.in_modal && this._wrapper && this._wrapper.wrapper.classList.add('modal-lg');

    this.body.show();
    this.show();
  }

  execute_primary_action() {
    this.primary_btn.focus();

    if (this.primary_action) {
      this.last_data ??= JSON.stringify(this.doc);
      if (this.last_data != JSON.stringify(this.doc)) {
        this.last_data = JSON.stringify(this.doc);
        this.primary_action();
      }
    } else {
      this.save();
    }
  }

  async make() {
    await super.make();

    this.customize();

    if (this.has_primary_action && this.in_modal) {
      const button = this.primary_btn;
      if (button) {
        button.on('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.execute_primary_action();
        });

        button.text(this.primary_action_label || __('Save'));
        button.removeClass('hide');
      }

      this.footer.removeClass('hide');
      this.footer.css('display', 'flex');
    } else {
      this.footer.hide();
    }

    this.make_custom_buttons_wrapper();
  }

  customize() {
    this.body.addClass('desk-form-body');
  }

  load() {
    this.before_load && this.before_load();
    super.initialize();
    this.initialize_fetches();
  }

  set_value(fieldname, value, on_reload = false) {
    const field = this.get_field(fieldname);
    if (field) {
      field.set_value && typeof field.set_value === 'function' && field.set_value(value);
    }
  }

  async reload(doc = null, from_server = false) {
    this.reloading = true;
    this.before_load && this.before_load();
    this.doc = doc || (await this.get_doc(from_server));

    this.doc = JSON.parse(JSON.stringify(this.doc));

    this.refresh();

    this.customize();
    this.reloading = false;

    setTimeout(() => {
      if (this.on_reload && typeof this.on_reload === 'function') {
        this.on_reload();
      }
      this.reloading = false;
    }, 100);

    return this;
  }

  background_reload() {
    this.get_doc(true).then((doc) => {
      this.doc = JSON.parse(JSON.stringify(doc));
      this.refresh();
    });
  }

  show() {
    this.is_hide = false;
    this._wrapper.show();
    return this;
  }

  hide() {
    this.is_hide = true;
    this._wrapper.hide();
    return this;
  }

  hide_field(fieldname) {
    if (Array.isArray(fieldname)) {
      fieldname.forEach((field) => {
        this.hide_field(field);
      });
    } else {
      this.set_field_display(fieldname, true);
    }
  }

  super_container_field(fieldname) {
    return $(this.get_field(fieldname).$wrapper.parent()[0]).parent()[0];
  }

  show_field(fieldname) {
    if (Array.isArray(fieldname)) {
      fieldname.forEach((field) => {
        this.show_field(field);
      });
    } else {
      this.set_field_display(fieldname, false);
    }
  }

  set_field_display(fieldname, hide) {
    const field = this.get_field(fieldname);
    if (field) {
      //field.df.hidden = hide;
      //field.refresh();
      field.$wrapper[hide ? 'hide' : 'show']();
    }
  }

  toggle() {
    this.is_hide ? this.show() : this.hide();
    return this;
  }

  make_custom_buttons_wrapper() {
    this.body.append(`
            <div class='widget-group custom-widget'>
                <div class=" widget-group-body grid-col-2"></div>
            </div>
        `);
  }

  add_action(
    { name, label, confirm = false, classes = '', style = '', type = 'default', icon = '', form_name = '' } = {},
    action
  ) {
    this.actions ??= {};

    const wrapper = this.body.find('.custom-widget');

    if (form_name == 'complete_order') {
      wrapper.find('.widget-group-body').append(`
            <a
                class="btn ${classes}"
                style="align-items:center;${style};"
                data-widget-name="${name}"
            >
                ${this.#action_content('', label, icon)}
            </a>
        `);
    } else {
      wrapper.find('.widget-group-body').append(`
        <a
            class="widget widget-shadow shortcut-widget-box ${classes} bg-${type}"
            style="align-items:center;${style};"
            data-widget-name="${name}"
        >
            ${this.#action_content('', label, icon)}
        </a>
    `);
    }

    this.actions[name] = frappe
      .jshtml({
        from_html: wrapper.find(`[data-widget-name="${name}"]`).get(0),
        content: this.#action_content('', '{{text}}', icon),
        text: `${__(label)}`,
      })
      .on(
        'click',
        () => {
          action && action();
        },
        confirm ? DOUBLE_CLICK : null
      );
  }

  #action_content(value, template = '', icon = '') {
    return `
        <div class="widget-head">
            <div>
                <div class="widget-title ellipsis" style="font-size: 1.2em;">
          <span class="${icon}" style="padding-right: 5px;"></span> ${template} ${value}
        </div>
                <div class="widget-subtitle"></div>
                <div class="widget-control"></div>
            </div>
        </div>`;
  }
};

RM.DeskModal = class DeskModal {
  constructor(options) {
    Object.assign(this, options);
    this.id = 'desk-modal-' + Math.random().toString(36).substr(2, 15);
    this.modal = null;
    this.construct();
  }

  set_props(props) {
    Object.assign(this, props);
  }

  remove() {
    this.modal && this.modal.$wrapper.remove();
  }

  construct() {
    this.modal = new frappe.ui.Dialog({
      title: this.title,
      primary_action_label: __('Save'),
    });

    this.show();

    if (this.full_page) {
      this.modal.$wrapper.find('.modal-dialog').css({
        width: '100%',
        height: '100%',
        left: '0',
        top: '0',
        margin: '0',
        padding: '0',
        'border-style': 'none',
        'max-width': 'unset',
        'max-height': 'unset',
      });

      this.modal.$wrapper.find('.modal-content').css({
        width: '100%',
        height: '100%',
        left: '0',
        top: '0',
        'border-style': 'none',
        'border-radius': '0',
        'max-width': 'unset',
        'max-height': 'unset',
      });
    }

    setTimeout(() => {
      this.render();
    }, 200);
  }

  _adjust_height() {
    return typeof this.adjust_height == 'undefined' ? 0 : this.adjust_height;
  }

  render() {
    this.set_title();

    if (typeof this.customize != 'undefined') {
      this.modal.$wrapper.find('.modal-body').empty();

      this.modal.$wrapper.css({
        height: `calc(100% - ${this._adjust_height()}px)`,
        'border-bottom': 'var(--default-line)',
      });

      this.modal.$wrapper.find('.modal-header').css({
        padding: '5px',
        'border-bottom': 'var(--default-line)',
        'border-radius': '0',
        /*"min-height": "50px"*/
      });

      this.modal.$wrapper.find('.modal-body').css({
        'background-color': 'transparent',
        padding: '0',
        'border-style': 'none',
        'border-radius': '0',
        'overflow-y': 'auto',
      });

      this.modal.$wrapper.find('.modal-title').css({
        margin: '0',
      });

      this.modal.$wrapper.find('.modal-actions').prepend("<span class='btn-container'></span>").css({
        top: '5px',
      });
    }

    if (typeof this.from_server == 'undefined') {
      if (this.callback) {
        this.callback(this);
      }
    } else {
      this.load_data();
    }
  }

  set_title(title) {
    this.modal.set_title(title);
  }

  get container() {
    return this.modal.$wrapper.find('.modal-body');
  }
  get title_container() {
    return this.modal.$wrapper.find('.modal-title');
  }
  get buttons_container() {
    return this.modal.$wrapper.find('.modal-actions .btn-container');
  }

  show() {
    this.modal.show();
  }

  hide() {
    this.modal.hide();
  }

  loading() {
    this.modal.fields_dict.ht.$wrapper.html(
      "<div class='loading-form' style='font-size: xx-large; text-align: center; color: #8D99A6'>" +
        __('Loading') +
        '...</div>'
    );
  }

  stop_loading() {
    //this.modal.fields_dict.ht.$wrapper.html("");
  }

  get _is_pdf() {
    return typeof this.is_pdf != 'undefined' && this.is_pdf === true;
  }

  get _args() {
    let args = this.args;
    return typeof args == 'undefined' || args == null ? {} : this.args;
  }

  get _pdf_url() {
    let url = `/api/method/frappe.utils.print_format.download_pdf?doctype=${this.model}&name=${this.model_name}`;
    let args = Object.assign(
      {
        no_letterhead: 1,
        letterhead: 'No%20Letterhead',
        settings: '%7B%7D',
      },
      this._args
    );

    Object.keys(args).forEach((k) => {
      url += '&' + k + '=' + args[k];
    });

    return url;
  }

  get pdf_template() {
    return `
 			<div class="col-md-12" style="margin-top: 15px">
 				<div class="pdf-container">
 					<embed src="${this._pdf_url}" frameborder="0" width="100%" height="400px">
 			 	</div>
 			 </div>
		`;
  }

  load_data() {
    if (this._is_pdf) {
      this.container.empty().append(this.pdf_template);
    } else {
      frappeHelper.api.call({
        model: this.model,
        name: this.model_name,
        method: this.action,
        args: {},
        always: (r) => {
          this.container.empty().append(r.message);
          this.stop_loading();
          if (this.callback) {
            this.callback(this);
          }
        },
      });
    }
  }

  reload() {
    this.load_data();
    return this;
  }
};

RM.NumPad = class NumPad {
  #input = null;
  #html = '';
  constructor(options) {
    Object.assign(this, options);
    this.make();
  }

  set html(val) {
    this.#html = val;
  }
  set input(val) {
    this.#input = val;
  }

  get input() {
    return this.#input;
  }
  get html() {
    return this.#html;
  }

  make() {
    const default_class = `pad-col button btn-default`;

    let num_pads = [
      {
        7: { props: { class: 'sm pad-btn' } },
        8: { props: { class: 'sm pad-btn' } },
        9: { props: { class: 'sm pad-btn' } },
        Del: {
          props: { class: 'md pad-btn' },
          content: '<span class="fa fa-arrow-left pull-left" style="font-size: 16px; padding-top: 3px"></span>',
          action: 'delete',
        },
      },
      {
        4: { props: { class: 'sm pad-btn' } },
        5: { props: { class: 'sm pad-btn' } },
        6: { props: { class: 'sm pad-btn' } },
        Enter: {
          props: { class: 'md pad-btn', rowspan: '3' },
          content: '<br><br><span class="fa fa-level-down" style="font-size: 25px; transform: rotate(90deg);"></span>',
          action: 'enter',
        },
      },
      {
        1: { props: { class: 'sm pad-btn' } },
        2: { props: { class: 'sm pad-btn' } },
        3: { props: { class: 'sm pad-btn' } },
      },
      {
        0: { props: { class: 'sm pad-btn', colspan: 2 } },
        '.': { props: { class: 'sm pad-btn' }, action: 'key' },
      },
    ];

    let html = "<table class='pad-container'><tbody>";
    num_pads.map((row) => {
      html += "<tr class='pad-row'>";

      Object.keys(row).map((key) => {
        let col = row[key];
        col.props.class += ` ${default_class}-${key}`;
        html += `${new JSHtml({
          tag: 'td',
          properties: col.props,
          content: `{{text}} ${typeof col.content != 'undefined' ? col.content : ''}`,
          text: __(key),
        })
          .on(
            'click',
            () => {
              if (col.action === 'enter') {
                if (this.on_enter != null) {
                  this.on_enter();
                }
              } else if (this.input) {
                if (col.action === 'delete') {
                  this.input.delete_value();
                } else {
                  this.input.write(key);
                }
              }
            },
            ''
          )
          .html()}`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    this.html = html;

    if (typeof this.wrapper != 'undefined') {
      $(this.wrapper).empty().append(this.html);
    }
  }
};

RM.FrappeHelperApi = class FrappeHelperApi {
  #api = this;
  constructor() {}

  get api() {
    return this.#api;
  }

  /**option{model, name, method}**/
  call(options = {}) {
    frappe.call({
      method: 'restaurant_management.api.call',
      args: { model: options.model, name: options.name, method: options.method, args: options.args },
      always: function (r) {
        options.always && options.always(r);
      },
      callback: function (r) {
        options.callback && options.callback(r);
      },
      success: function (r) {
        options.success && options.success(r);
      },
      error: function (r) {
        options.error && options.error(r);
      },
      freeze: !!options.freeze,
    });
  }
};

RM.frappeHelper = new RM.FrappeHelperApi();

window.DeskForm = RM.DeskForm;
window.JSHtml = RM.JSHtml;
window.frappeHelper = RM.frappeHelper;
window.DeskModal = RM.DeskModal;
window.NumPad = RM.NumPad;
window.ObjectManage = RM.ObjectManage;

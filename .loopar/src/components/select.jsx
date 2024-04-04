import BaseInput from "$base-input";
import http from "$tools/router/http";

import React, { useState, useEffect } from "react"
import { CaretSortIcon, CheckIcon, Cross2Icon } from "@radix-ui/react-icons"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

import { useFormContext } from "@context/form-context"
import loopar from "$loopar"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import {
  FormDescription,
  FormLabel
} from "@/components/ui/form"

function SelectFn({search, selectData, onSelect, options, field, ...props}) {

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [searching, setSearching] = useState(false);
  //const [value, setValue] = useState(props.initialValue);
  //const [options, setOptions] = useState(props.options?.length > 0 ? props.options : value ? [value] : []);
  const formContext = useFormContext();

  const openHandler = (e) => {
    setSearching(true);
    setOpen(e);

    search(null, false).then((result) => {
      setSearching(false);
    });
  }

  const searchHandler = (e) => {
    search(e, true);
  }

  /*const getOption = (option) => {
    return options.find((item) => item.option === option);
  }*/

  const setValueHandler = (e) => {
    setOpen(false);
    onSelect(e);
  }

  useEffect(() => {
    if (!field.value && props.defaultValue) {
      setValueHandler(props.defaultValue);
    }
  }, [field.value])

  const value = loopar.utils.isJSON(field.value) ? JSON.parse(field.value).option : field.value;

  return (
    <Popover open={open} onOpenChange={openHandler} className="pb-4">
      <PopoverTrigger asChild >
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            "w-full justify-between pr-1",// max-w-sm
            !field.value && "text-muted-foreground"
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openHandler(!open);
          }}
          onMouseEnter={setActive}
          onMouseLeave={() => setActive(false)}
        >
          {
            field.value ?
            options.find((option) => option.option === value)?.option || `Select ${selectData.label}`:
            props.defaultValue || `Select ${selectData.label}`
          }
          <div className="flex flex-row items-center justify-between">
            <Cross2Icon
              className={`h-5 w-5 shrink-0 ${active ? "opacity-50" : "opacity-0"}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setValueHandler(null);
                searchHandler(null);
              }}
            />
            <CaretSortIcon className="ml-1 h-5 w-5 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full min-w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput
            placeholder={`Search ${selectData.label}...`}
            className="h-9"
            onKeyUp={searchHandler}
          />
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            {options.map((option) => (
              <CommandItem
                value={option.option}
                key={option.option}
                onSelect={() => setValueHandler(option.option)}
              >
                {option.title || option.value || option.option}
                <CheckIcon
                  className={cn(
                    "ml-auto h-4 w-4",
                    option.option === field.value
                      ? "opacity-100"
                      : "opacity-0"
                  )}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default class Select extends BaseInput {
  #model = null;
  filteredOptions = [];
  titleFields = ["value"];

  /*get requires() {
    return {
      css: ["/assets/plugins/bootstrap/css/select2"],
    };
  }*/

  constructor(props) {
    super(props);

    this.state = {
      ...this.state,
      //valid: true,
      rows: []
    };
  }

  render() {
    const data = this.data || { label: "Select", name: "select", value: ""};
    this.assignedValue = data.value;

    return this.renderInput((field) => (
      <div>
        {!this.props.dontHaveLabel && <FormLabel>{data.label}</FormLabel>}
        <SelectFn
          field={field}
          options={this.state.rows}
          search={(delay) => this.#search(delay)}
          selectData={data}
          onSelect={field.onChange}
          defaultValue={data.selected}
        />
        {data.description && (
          <FormDescription>{data.description}</FormDescription>
        )}
      </div>
    ));
  }

  componentDidMount() {
    super.componentDidMount();
    const data = this.data;
    const initialRows = loopar.utils.isJSON(data.value) ? [JSON.parse(data.value)] : [{ option: data.value, title: data.value}];

    this.setState({ rows: initialRows })
    //console.log("Select Component Mounted", this.optionsSelect)
  }

  #search(target, delay = true) {
    const q = target?.target?.value || "";
    return new Promise((resolve, reject) => {
      if (this.isLocal) {
        this.filteredOptions = this.optionsSelect
          .filter((row) => {
            return (typeof row == "object" ? `${row.option} ${row.title}` : row)
              .toLowerCase()
              .includes(q);
          })
          .map((row) => {
            return typeof row == "object" ? row : { option: row, title: row };
          });

        resolve(this.renderResult());
      } else {
        this.#model = this.optionsSelect[0];
        if (delay) {
          clearTimeout(this.lastSearch);
          this.lastSearch = setTimeout(() => {
            this.getServerData(q).then(resolve);
          }, 200);
        } else {
          this.getServerData(q).then(resolve);
        }
      }
    });
  }

  get isLocal() {
    return this.optionsSelect.length > 1;
  }

  get model() {
    return this.#model.option || this.#model.name;
  }

  get options() { }

  get optionsSelect() {
    const opts = this.data.options || "";

    if (typeof opts == "object") {
      if (Array.isArray(opts)) {
        return opts;
      } else {
        return Object.keys(opts).map((key) => ({
          option: key,
          title: opts[key],
        }));
      }
    } else if (typeof opts == "string") {
      return opts.split(/\r?\n/).map((item) => {
        const [option, title] = item.split(":");
        return { option, title: option || title };
      });
    }

    /*return typeof opts == 'object' && Array.isArray(opts) ? opts :
         opts.split(/\r?\n/).map(item => ({option: item, value: item}));*/
  }

  get searchQuery() {
    return this.inputSearch?.node?.value || "";
  }

  getServerData(q) {
    return new Promise((resolve, reject) => {
      http.send({
        action: `/api/${this.model}/search`,
        params: { q },
        success: (r) => {
          this.titleFields = r.titleFields;
          this.filteredOptions = this.getPrepareOptions(r.rows);
          resolve(this.renderResult());
        },
        error: (r) => {
          console.log(r);
        },
        freeze: false,
      });
    });
  }

  renderResult() {
    //return this.filteredOptions;
    this.setState({ rows: this.filteredOptions });
  }

  optionValue(option = this.currentSelection) {
    const value = (data) => {
      if (data && typeof data == "object") {
        if (Array.isArray(this.titleFields)) {
          const values = this.titleFields.map((item) => data[item]);

          return values
            .reduce((a, b) => {
              return [
                ...a,
                [...a.map((item) => item.toLowerCase())].includes(
                  b.toLowerCase()
                )
                  ? ""
                  : b,
              ];
            }, [])
            .join(" ");
        } else {
          return data[this.titleFields];
        }
      }
    };

    return option && typeof option == "object"
      ? {
        option: option.option || option.name,
        title: value(option), //option[this.titleFields] || option.value || option.option
      }
      : {
        option: option || this.assignedValue,
        title: option || this.assignedValue,
      };
  }

  /**
   *
   * #param {string || object} val
   * #param {boolean} trigger_change
   * #returns
   */
  val(val = null, { trigger_change = true } = {}) {
    if (val != null) {
      this.assignedValue = val;
      this.renderValue(trigger_change);
      return this;
    } else {
      return this.data.value;
    }
  }

  value(val) {
    const value = super.value();

    if(loopar.utils.isJSON(value)) {
      return JSON.parse(value).option;
    }else {
      return value;
    }
  }

  getPrepareOptions(options) {
    return options.map((item) => {
      return typeof item == "object" ? { option: item.title || item.name, title: item.value || item.description || item.title } : { option: item, title: item };
    });
  }

  get currentSelection() {
    return Object.keys(this.filteredOptions || {}) > 0
      ? this.filteredOptions.filter(
        (item) =>
          this.optionValue(item).option ===
          this.optionValue(this.assignedValue).option
      )[0]
      : this.assignedValue;
  }

  get metaFields() {
    const data = super.metaFields[0];

    data.elements.options = {
      element: TEXTAREA,
      data: {
        description:
          "For simple select insert the options separated by enter. For Document Select insert the Document Name",
      },
    };

    return [data];
  }
}
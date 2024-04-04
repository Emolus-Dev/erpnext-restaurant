//import { decamelize } from '/tools/decamelize.js';
import cookie from './cookie-manager.js';
const _text = (text) => {
  return text || "Undefined"
}

const handlePreserveConsecutiveUppercase = (decamelized, separator) => {
  // Lowercase all single uppercase characters. As we
  // want to preserve uppercase sequences, we cannot
  // simply lowercase the separated string at the end.
  // `data_For_USACounties` → `data_for_USACounties`
  decamelized = decamelized.replace(
    /((?<![\p{Uppercase_Letter}\d])[\p{Uppercase_Letter}\d](?![\p{Uppercase_Letter}\d]))/gu,
    $0 => $0.toLowerCase(),
  );

  // Remaining uppercase sequences will be separated from lowercase sequences.
  // `data_For_USACounties` → `data_for_USA_counties`
  return decamelized.replace(
    /(\p{Uppercase_Letter}+)(\p{Uppercase_Letter}\p{Lowercase_Letter}+)/gu,
    (_, $1, $2) => $1 + separator + $2.toLowerCase(),
  );
};

function camelCase(str) {
  return str.toLowerCase().replace(/[_-](.)/g, (_, letter) => letter.toUpperCase());
}

function decamelize(text, { separator = '-', preserveConsecutiveUppercase = false } = {}) {
  text = _text(text).replaceAll(/\s/g, '');
  if (!(typeof text === 'string' && typeof separator === 'string')) {
    throw new TypeError(
      'The `text` and `separator` arguments should be of type `string`',
    );
  }

  // Checking the second character is done later on. Therefore process shorter strings here.
  if (text.length < 2) {
    return preserveConsecutiveUppercase ? text : text.toLowerCase();
  }

  const replacement = `$1${separator}$2`;

  // Split lowercase sequences followed by uppercase character.
  // `dataForUSACounties` → `data_For_USACounties`
  // `myURLstring → `my_URLstring`
  const decamelized = text.replace(
    /([\p{Lowercase_Letter}\d])(\p{Uppercase_Letter})/gu,
    replacement,
  );

  if (preserveConsecutiveUppercase) {
    return handlePreserveConsecutiveUppercase(decamelized, separator);
  }

  // Split multiple uppercase characters followed by one or more lowercase characters.
  // `my_URLstring` → `my_ur_lstring`
  return decamelized
    .replace(
      /(\p{Uppercase_Letter})(\p{Uppercase_Letter}\p{Lowercase_Letter}+)/gu,
      replacement,
    )
    .toLowerCase();
}

function kebabToPascal(kebabString) {
  return kebabString
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 *
 * @param {*} text as string
 * @returns
 */
function Capitalize(text) {
  return _text(text).charAt(0).toUpperCase() + _text(text).slice(1);
}

/**
 *
 * @param {*} text as string
 * @returns
 */
function UPPERCASE(text) {
  return _text(text).toUpperCase();
}

/**
 *
 * @param {*} text as string
 * @returns
 */
function lowercase(text) {
  return _text(text).toLowerCase();
}

/**
 *
 * @param {*} name
 * @returns
 */
function debug_name(name) {
  return _text(name).replace(/\s|-/g, "_");
}

/**
 *
 * @param {*} text
 * @returns
 */

function hash(input) {
  return crypto.MD5(input).toString();
}

/**
 *
 * @param {*} value
 * @returns
 */
function trueValue(value) {
  return [true, "true", 1, "1"].includes(value);
}

function trueToBinary(value) {
  return trueValue(value) ? 1 : 0;
}

function binaryValue(value) {
  return [1, "1"].includes(value);
}

function nullValue(value) {
  return [null, "null", undefined, "undefined"].includes(value);
}

function avatar(name, size = 32) {
  return (name.split(" ").map((n) => n.charAt(0)).join("").toUpperCase()).slice(0, 2);
}

function humanize(string) {
  if (typeof string !== 'string') {
    throw new TypeError('Expected a string');
  }

  string = decamelize(string);
  string = string.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  string = string.charAt(0).toUpperCase() + string.slice(1);

  return string;
}

function isJSON(str) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

function fixJSON(json) {
  json = json.replace(`""""`, `""`).replace('&#34;&#34;&#34;&#34', ';&#34;&#34;');
  if (json.includes('""""') || json.includes('&#34;&#34;&#34;&#34')) {
    json = fixJSON(json);
  }

  return json;
}

function JSONstringify(obj) {
  return Flatted.stringify(obj);
}

function JSONparse(obj) {
  const text = fixJSON(obj);

  return typeof obj == "object" ? obj : JSON.parse(fixJSON(obj));
}

function randomString(length = 15) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxy';
  const characters = `0123456789${alphabet}${Date.now()}`.split('').sort(() => Math.random() - Math.random()).join('');
  const start = Math.floor(Math.random() * (characters.length - length));
  return `${alphabet.charAt(Math.floor(Math.random() * alphabet.length))}${characters.slice(start + 1, start + length)}`
}

function avatarLetter(word) {
  let value = "";

  if (word) {
    word.split(" ").forEach(word => {
      value += word[0].toUpperCase();
    });
  }

  return value;
}

function fieldList(fields) {
  fields = isJSON(fields) ? JSONparse(fields) : fields;

  return (fields || []).reduce((acc, field) => {
    return acc.concat(field, fieldList(field.elements || []));
  }, []);
}

function rgba(hex, alpha = 1) {
  let base = typeof hex == "object" ? hex : isJSON(hex) ? JSONparse(hex) : hex || {};
  hex = base.color || hex;
  alpha = base.alpha || alpha;

  try {
    const hexRegex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
    if (!hexRegex.test(hex)) {
      throw new Error("Formato hexadecimal de color incorrecto");
    }
    hex = hex.replace(/^#/, '');

    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;

    const a = alpha || 1;

    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } catch (error) {
    return null;
  }
}

function aspectRatio(ratio) {
  const [width, height] = ratio.split(":");
  return (height / width) * 100;
}

function renderizableProps(props) {
  return Object.keys(props).reduce((acc, key) => {
    if (typeof props[key] != 'object' || (typeof props[key] === 'function' || key === "children" || key === "style")) {
      acc[key] = props[key];
    }
    return acc;
  }, {});
}

export {
  Capitalize,
  UPPERCASE,
  lowercase,
  debug_name,
  hash,
  trueValue,
  trueToBinary,
  humanize,
  JSONstringify,
  JSONparse,
  decamelize,
  avatar,
  randomString,
  avatarLetter,
  camelCase,
  nullValue,
  isJSON,
  fieldList,
  rgba,
  aspectRatio,
  kebabToPascal,
  cookie,
  renderizableProps,
  binaryValue,
}
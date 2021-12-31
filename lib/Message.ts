const _ = require('lodash');

// Version of node-re2 that uses latin1; searching by byte value, not
// by Unicode code-points.
const RE2 = require("re2-latin1");

// This regex is based on RFC-822 “simple field parsing” specifically
// section “B.1. SYNTAX” but extended to accept byte values in the
// range 128 to 255 to support UTF-8 encoding in the bodies of header
// fields as specified by RFC-6531.
// See <https://datatracker.ietf.org/doc/html/rfc822#appendix-B.1>

// This regex will accept RFC-5322 “Obsolete Syntax.”

// prettier-ignore
const message_re = new RE2('(?<header>' +
                             '(?<field_name>[^\\x00-\\x20\\x80-\\xFF\\:]+)' +
                               '(?:(?:\\r?\\n)?(?:\\x20|\\x09))*' +
                               '\\:' +
                             '(?<field_body>' +
                               '(?:(?:(?:\\r?\\n)?(?:\\x20|\\x09))*[\\x00-\\xFF]*?)*(?:\\r?\\n))' +
                           ')|' +
                           '(?<body>\\r?\\n[\\x00-\\xFF]*$)', 'gs');

export function unfold(field_body: string) {
 return field_body.replace(/(?:(?:\r?\n)(?:\x20|\x09))/g, ' ').trim();
}

export interface Field {
  name: string;
  value: string;
  full_header: string;
  parsed: any;
}

export interface FieldIdx  {
  [name: string]: Field[]
}

export class Message {
  headers: Field[];
  body: Buffer | null;
  hdr_idx: FieldIdx;
  parts: Message[] | null;

  constructor(data: Buffer) {
    let match : any;

    this.headers = [];
    this.body = null;
    this.hdr_idx = {};
    this.parts = null;

    var next_match = 0;         // offset where we expect to find the next match

    while (match = message_re.exec(data)) {
      const match_length = match[0].length;

      /* Check to see we haven't skipped over any bytes that did not
       * match either a header or a body.
       */
      if (message_re.lastIndex !== next_match + match_length) {
        const unm_len = message_re.lastIndex - (next_match + match_length);
        throw new Error(`Unmatched at ${next_match}: "${data.slice(next_match, next_match + unm_len)}"`);
      }

      if (match.groups.header) {
        this.headers.push({
          name: match.groups.field_name.toString(),
          value: match.groups.field_body.toString().trim(),
          full_header: match.groups.header.toString(),
          parsed: undefined,
        });
        next_match += match.groups.header.length;
      } else if (match.groups.body) {
        this.body = match.groups.body;
        next_match += match.groups.body.length;
      } else {
        const unm_len = message_re.lastIndex - (next_match + match_length);
        throw new Error(`Unknown match at ${next_match}: "${data.slice(next_match, next_match + unm_len)}"`);
      }
    }

    // Build a header index.
    for (const hdr of this.headers) {
      const key = hdr.name.toLowerCase();
      if (this.hdr_idx[key] === undefined) {
        this.hdr_idx[key] = [hdr];
      } else {
        this.hdr_idx[key].push(hdr);
      }
    }
  }

  find_parts(boundary: string) {
    if (this.body === null) {
      throw new Error(`no body to find parts in`);
    }
    console.log(`###### find_parts(${boundary})`);

    // prettier-ignore
    const multi_re = new RE2('(?<start>\r?\n--' + _.escapeRegExp(boundary) + '[ \t]*\r?\n)|' +
                             '(?<end>\r?\n--' + _.escapeRegExp(boundary) + '--[ \t]*\r?\n)', 'gs');

    var parts: Buffer[];

    var start_found = false;

    let match : any;
    while (match = multi_re.exec(this.body)) {
      const match_length = match[0].length;

      if (match.groups.start) {
        console.log(`###### found start`);
        start_found = true;
      } else if (match.groups.end) {
        if (!start_found) {
          console.log(`###### start NEVER FOUND!`);
        }
        console.log(`###### found end`);
        return true;
      }
    }

    console.log(`###### end NEVER FOUND!`);
    return false;
  }
}

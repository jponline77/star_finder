// Stable identities for spreadsheet rows, shared by the importer and the API.
//
// `sheet:` keys come from the RAW spreadsheet values (before corrections), so they survive a new
// correction and any rename/move an admin makes on the website. They are stored in
// songs.import_key / shows.import_key when the importer creates or first matches a row.
// `name:` keys come from the canonical names and are only used to remember (tombstone) the
// deletion of an old row that never got a `sheet:` key.
import { fold } from './text.js';

const norm = (s) => fold(String(s ?? '')).replace(/\s+/g, ' ').trim();

export const songImportKey = (kind, rawShow, rawTitle) => `sheet:${kind}|${norm(rawShow)}|${norm(rawTitle)}`;
export const showImportKey = (rawShow) => `sheet:${norm(rawShow)}`;
export const songNameKey = (kind, show, title) => `name:${kind}|${norm(show)}|${norm(title)}`;
export const showNameKey = (name) => `name:${norm(name)}`;

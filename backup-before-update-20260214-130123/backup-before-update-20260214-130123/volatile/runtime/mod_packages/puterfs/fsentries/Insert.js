const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['989da079-b349-4b99-a3de-f3f065010c9b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import { safeHasOwnProperty } from '../lib/objectfn.js';
import BaseOperation from './BaseOperation.js';

export default class extends BaseOperation {
    static requiredForCreate = [
        'uuid',
        'parent_uid',
    ];

    static allowedForCreate = [
        ...this.requiredForCreate,
        'name',
        'user_id',
        'is_dir',
        'created',
        'modified',
        'immutable',
        'shortcut_to',
        'is_shortcut',
        'metadata',
        'bucket',
        'bucket_region',
        'thumbnail',
        'accessed',
        'size',
        'symlink_path',
        'is_symlink',
        'associated_app_id',
        'path',
    ];

    constructor (entry) {
        super();
        const requiredForCreate = this.constructor.requiredForCreate;
        const allowedForCreate = this.constructor.allowedForCreate;

        {
            const sanitized_entry = {};
            for ( const k of allowedForCreate ) {
                if ( safeHasOwnProperty(entry, k) ) {
                    sanitized_entry[k] = entry[k];
                }
            }
            entry = sanitized_entry;
        }

        for ( const k of requiredForCreate ) {
            if ( ! safeHasOwnProperty(entry, k) ) {
                throw new Error(`Missing required property: ${k}`);
            }
        }

        this.entry = entry;
    }

    getStatement () {
        const fields = Object.keys(this.entry);
        const statement = 'INSERT INTO fsentries ' +
            `(${fields.join(', ')}) ` +
            `VALUES (${fields.map(() => '?').join(', ')})`;
        const values = fields.map(k => this.entry[k]);
        return { statement, values };
    }

    apply (answer) {
        answer.entry = { ...this.entry };
    }

    get uuid () {
        return this.entry.uuid;
    }
};

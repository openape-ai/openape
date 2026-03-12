/**
 * @openape/unstorage-s3-driver
 *
 * Fork of unstorage's built-in S3 driver with fix for S3-compatible providers
 * that don't send XML prolog (Exoscale SOS, MinIO, etc.)
 *
 * Based on unstorage v1.17.4 drivers/s3.mjs
 */
import { AwsClient } from 'aws4fetch';
// Inlined from unstorage/drivers/utils to avoid dependency resolution issues
function defineDriver(factory) { return factory; }
function normalizeKey(key, sep = ':') {
    if (!key)
        return '';
    return key.replace(/[:/\\]/g, sep).replace(/^[:/\\]|[:/\\]$/g, '');
}
function createError(driver, message) {
    const err = new Error(`[unstorage] [${driver}] ${message}`);
    if ('captureStackTrace' in Error)
        Error.captureStackTrace(err, createError);
    return err;
}
function createRequiredError(driver, name) {
    return createError(driver, `Missing required option \`${name}\`.`);
}
const DRIVER_NAME = 's3-compat';
export default defineDriver((options) => {
    let _awsClient;
    const getAwsClient = () => {
        if (!_awsClient) {
            if (!options.accessKeyId)
                throw createRequiredError(DRIVER_NAME, 'accessKeyId');
            if (!options.secretAccessKey)
                throw createRequiredError(DRIVER_NAME, 'secretAccessKey');
            if (!options.endpoint)
                throw createRequiredError(DRIVER_NAME, 'endpoint');
            if (!options.region)
                throw createRequiredError(DRIVER_NAME, 'region');
            _awsClient = new AwsClient({
                service: 's3',
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
                region: options.region,
            });
        }
        return _awsClient;
    };
    const baseURL = `${options.endpoint.replace(/\/$/, '')}/${options.bucket || ''}`;
    const prefix = options.prefix ? normalizeKey(options.prefix, '/') : '';
    const url = (key = '') => {
        const normalized = normalizeKey(key, '/');
        const fullKey = prefix ? `${prefix}/${normalized}` : normalized;
        return `${baseURL}/${fullKey}`;
    };
    const awsFetch = async (url, opts) => {
        const request = await getAwsClient().sign(url, opts);
        const res = await fetch(request);
        if (!res.ok) {
            if (res.status === 404)
                return null;
            throw createError(DRIVER_NAME, `[${request.method}] ${url}: ${res.status} ${res.statusText} ${await res.text()}`);
        }
        return res;
    };
    const headObject = async (key) => {
        const res = await awsFetch(url(key), { method: 'HEAD' });
        if (!res)
            return null;
        const metaHeaders = {};
        for (const [key2, value] of res.headers.entries()) {
            const match = /x-amz-meta-(.*)/.exec(key2);
            if (match?.[1])
                metaHeaders[match[1]] = value;
        }
        return metaHeaders;
    };
    const listObjects = async (base) => {
        const listPrefix = [prefix, base ? normalizeKey(base, '/') : ''].filter(Boolean).join('/');
        const listUrl = listPrefix ? `${baseURL}?prefix=${encodeURIComponent(listPrefix + '/')}` : baseURL;
        const res = await awsFetch(listUrl).then(r => r?.text());
        if (!res)
            return null;
        const keys = parseList(res);
        const stripLen = prefix ? prefix.length + 1 : 0;
        return keys.map(k => k.slice(stripLen).replace(/\//g, ':'));
    };
    const getObject = (key) => awsFetch(url(key));
    const putObject = async (key, value) => {
        return awsFetch(url(key), { method: 'PUT', body: value });
    };
    const deleteObject = async (key) => {
        return awsFetch(url(key), { method: 'DELETE' });
    };
    return {
        name: DRIVER_NAME,
        options,
        hasItem: async (key) => !!(await headObject(key)),
        getItem: async (key) => {
            const res = await getObject(key);
            if (!res)
                return null;
            return res.text();
        },
        getItemRaw: async (key) => {
            const res = await getObject(key);
            if (!res)
                return null;
            return res.arrayBuffer();
        },
        setItem: async (key, value) => {
            await putObject(key, value);
        },
        setItemRaw: async (key, value) => {
            await putObject(key, value);
        },
        removeItem: async (key) => {
            await deleteObject(key);
        },
        getMeta: async (key) => {
            const headers = await headObject(key);
            if (!headers)
                return null;
            return headers;
        },
        getKeys: async (base) => {
            const keys = await listObjects(base);
            if (!keys)
                return [];
            return keys;
        },
        clear: async (base) => {
            const keys = await listObjects(base);
            if (!keys)
                return;
            await Promise.all(keys.map(key => deleteObject(key)));
        },
    };
});
/**
 * Parse S3 ListBucketResult XML — works with AND without <?xml prolog
 * This is the fix for S3-compatible providers like Exoscale SOS.
 */
function parseList(xml) {
    // Accept XML with or without prolog — Exoscale SOS omits it
    const listBucketResult = xml.match(/<ListBucketResult[^>]*>([\s\S]*)<\/ListBucketResult>/)?.[1];
    if (!listBucketResult) {
        // Only throw if it's not valid XML at all
        if (!xml.includes('<')) {
            throw new Error('Invalid response from S3: not XML');
        }
        // Check for error response
        const errorMsg = xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1];
        if (errorMsg) {
            throw new Error(`S3 error: ${errorMsg}`);
        }
        throw new Error('Missing <ListBucketResult>');
    }
    const contents = listBucketResult.match(/<Contents[^>]*>([\s\S]*?)<\/Contents>/g);
    if (!contents?.length)
        return [];
    return contents
        .map(content => content.match(/<Key>([\s\S]+?)<\/Key>/)?.[1])
        .filter(Boolean);
}

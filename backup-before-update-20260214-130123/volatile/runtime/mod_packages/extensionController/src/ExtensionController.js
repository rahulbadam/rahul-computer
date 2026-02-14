const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['64f878ea-62e1-46bc-a8bb-1756f4513ca7'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import { StatusCodes } from 'http-status-codes';
/**
 * Class decorator to set prefix on prototype and register routes on instantiation
 * @argument prefix - prefix for all routes under the class
 * @argument [adminUsernames] - gate all routes behind admin username check
 */
export const Controller = (prefix, adminUsernames, allowedAppIds) => {
    return (target) => {
        target.prototype.__controllerPrefix = prefix;
        target.prototype.__allowedAppIds = allowedAppIds;
        target.prototype.__adminUsernames = adminUsernames
            ? [...adminUsernames, 'admin', 'system']
            : undefined;
    };
};
const createMethodDecorator = (method) => {
    return (path, routeOptions, adminUsernames) => {
        const { allowedAppIds, ...options } = routeOptions ?? {};
        return (target, _context) => {
            _context.addInitializer(function () {
                // eslint-disable-next-line no-invalid-this
                const proto = Object.getPrototypeOf(this); // will be bound to class
                if ( ! proto.__routes ) {
                    proto.__routes = [];
                }
                proto.__routes.push({
                    method,
                    path,
                    options: options,
                    adminUsernames: adminUsernames
                        ? [...adminUsernames, 'admin', 'system']
                        : undefined,
                    allowedAppIds,
                    handler: target,
                });
            });
        };
    };
};
// HTTP method decorators
export const Get = createMethodDecorator('get');
export const Post = createMethodDecorator('post');
export const Put = createMethodDecorator('put');
export const Delete = createMethodDecorator('delete');
// TODO DS: add others as needed (patch, etc)
export class HttpError extends Error {
    statusCode;
    constructor (statusCode, message, cause) {
        super(`${statusCode} - ${message}`, { cause });
        this.statusCode = statusCode;
    }
}
// Registers all routes from a decorated controller instance to an Express router
export class ExtensionController {
    logger;
    // TODO DS: make this work with other express-like routers
    registerRoutes () {
        const logger = this.logger || console;
        const prefix = Object.getPrototypeOf(this).__controllerPrefix || '';
        const adminsForController = Object.getPrototypeOf(this).__adminUsernames;
        const allowedAppIdsForController = Object.getPrototypeOf(this).__allowedAppIds;
        const routes = Object.getPrototypeOf(this).__routes || [];
        for ( const route of routes ) {
            const fullPath = `${prefix}/${route.path}`.replace(/\/+/g, '/');
            const adminsForRoute = route.adminUsernames
                ? adminsForController
                    ? adminsForController.concat(route.adminUsernames)
                    : route.adminUsernames
                : adminsForController
                    ? adminsForController
                    : undefined;
            const allowedAppIds = route.allowedAppIds
                ? allowedAppIdsForController
                    ? allowedAppIdsForController.concat(route.allowedAppIds)
                    : route.allowedAppIds
                : allowedAppIdsForController
                    ? allowedAppIdsForController
                    : undefined;
            if ( ! extension[route.method] ) {
                throw new Error(`Unsupported HTTP method: ${route.method}`);
            }
            else {
                logger.log(`Registering route: [${route.method.toUpperCase()}] ${fullPath}`);
                extension[route.method](fullPath, route.options || {}, async (req, res, next) => {
                    try {
                        if ( adminsForRoute || allowedAppIds ) {
                            if ( ! req.actor ) {
                                throw new HttpError(StatusCodes.UNAUTHORIZED, 'Unauthenticated');
                            }
                        }
                        if ( adminsForRoute ) {
                            if ( ! adminsForRoute.includes(req.actor.type.user.username) ) {
                                throw new HttpError(StatusCodes.FORBIDDEN, 'Only admins may request this resource.');
                            }
                        }
                        if ( allowedAppIds ) {
                            if (( req.actor.type?.app?.uid && !allowedAppIds.includes(req.actor.type.app.uid) )) {
                                throw new HttpError(StatusCodes.FORBIDDEN, 'This app may not request this resource.');
                            }
                        }
                        await route.handler.bind(this)(req, res, next);
                    }
                    catch ( error ) {
                        if ( error instanceof HttpError ) {
                            res.status(error.statusCode).send({ error: error.message });
                            logger.warn('httpError:', error);
                            return;
                        }
                        if ( error instanceof Error ) {
                            res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({ error: error.message });
                            logger.error('Non-http error:', error);
                            return;
                        }
                        res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({ error: 'An unknown error occurred' });
                        logger.error('An unknown error occurred:', error);
                    }
                });
            }
        }
    }
}
//# sourceMappingURL=ExtensionController.js.map
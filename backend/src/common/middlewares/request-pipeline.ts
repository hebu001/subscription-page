import cookieParser from 'cookie-parser';
import { json, Request, Response, NextFunction } from 'express';

import { NestExpressApplication } from '@nestjs/platform-express';

import { TypedConfigService } from '@common/config/app-config';

import { createAccessLogMiddleware } from './access-log.middleware';
import { checkAssetsCookieMiddleware } from './check-assets-cookie.middleware';
import { getRealIp } from './get-real-ip.middleware';
import { noRobotsMiddleware } from './no-robots.middleware';
import { proxyCheckMiddleware } from './proxy-check.middleware';

/** Shared production pipeline: guards must retain observed Host, protocol and cookies. */
export function installRequestMiddleware(
    app: NestExpressApplication,
    config: TypedConfigService,
    output: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
): void {
    app.use(createAccessLogMiddleware(output, config.get('CUSTOM_SUB_PREFIX')));
    app.set('etag', false);
    app.disable('x-powered-by');
    app.set('trust proxy', config.getOrThrow('TRUST_PROXY'));
    app.use('/internal/health', (req: Request, res: Response, next: NextFunction) => {
        const ip = req.socket.remoteAddress ?? '';
        const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        if (loopback && !req.headers['x-forwarded-for'] && req.path === '/') {
            res.status(200).type('text/plain').send('OK');
            return;
        }
        next();
    });
    app.use(proxyCheckMiddleware);
    app.use(cookieParser());
    // Run at the full path: config selection compares /assets/.app-config-v2.json.
    app.use(checkAssetsCookieMiddleware);
    app.use(json({ limit: '32kb' }));
    app.use(noRobotsMiddleware, getRealIp);
    // Panel headers are filtered on copies in AxiosService. Mutating request headers
    // here would erase Host/protocol needed by PaymentSessionGuard's origin check.
}

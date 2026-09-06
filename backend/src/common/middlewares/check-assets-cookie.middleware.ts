import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

import { Logger } from '@nestjs/common';

import { APP_CONFIG_ROUTE_LEADING_PATH } from '@remnawave/subscription-page-types';

import {
    isSubscriptionSession,
    selectSubscriptionSession,
    SHORT_UUID_RE,
    SUBSCRIPTION_SELECTOR_HEADER,
} from '@common/utils/subscription-session';
import { safeErrorDiagnostics } from '@common/utils/filter-logs/safe-error';
import { IJwtPayload } from '@common/constants';

const logger = new Logger('CheckAssetsCookieMiddleware');

export function checkAssetsCookieMiddleware(
    req: { user: IJwtPayload } & Request,
    res: Response,
    next: NextFunction,
) {
    if (req.path.startsWith('/assets') || req.path.startsWith('/locales')) {
        const secret = process.env.INTERNAL_JWT_SECRET;
        const isConfig = req.path === APP_CONFIG_ROUTE_LEADING_PATH;
        const selector = isConfig ? req.get(SUBSCRIPTION_SELECTOR_HEADER) : undefined;
        const reject = (status = 401) => {
            if (isConfig) {
                res.setHeader('Cache-Control', 'private, no-store, max-age=0');
                res.status(status).end();
            } else {
                res.socket?.destroy();
            }
        };

        if (!secret) {
            logger.error('INTERNAL_JWT_SECRET is not set');
            reject();

            return;
        }

        if (selector !== undefined && !SHORT_UUID_RE.test(selector)) {
            reject();
            return;
        }
        const { token, scoped } =
            selector === undefined
                ? { token: req.cookies?.session, scoped: false }
                : selectSubscriptionSession(req.cookies, selector, process.env.CUSTOM_SUB_PREFIX);

        if (typeof token !== 'string' || !token) {
            logger.debug('No session cookie found');
            reject();

            return;
        }

        try {
            const jwtPayload = jwt.verify(token, secret);
            if (!isSubscriptionSession(jwtPayload)) {
                reject();
                return;
            }
            if (selector !== undefined && jwtPayload.shortUuid !== selector) {
                reject(scoped ? 404 : 401);
                return;
            }

            req.user = jwtPayload;
        } catch (error) {
            logger.debug({
                message: 'Asset session verification failed',
                ...safeErrorDiagnostics(error),
            });
            reject();

            return;
        }
    }

    return next();
}

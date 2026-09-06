import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

import { Logger } from '@nestjs/common';

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

        if (!secret) {
            logger.error('INTERNAL_JWT_SECRET is not set');
            res.socket?.destroy();

            return;
        }

        if (!req.cookies.session) {
            logger.debug('No session cookie found');
            res.socket?.destroy();

            return;
        }

        try {
            const jwtPayload = jwt.verify(req.cookies.session, secret);

            req.user = jwtPayload as unknown as IJwtPayload;
        } catch (error) {
            logger.debug({
                message: 'Asset session verification failed',
                ...safeErrorDiagnostics(error),
            });
            res.socket?.destroy();

            return;
        }
    }

    return next();
}

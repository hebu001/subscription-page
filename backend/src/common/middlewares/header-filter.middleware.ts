import { Request, Response, NextFunction } from 'express';

import { IGNORED_HEADERS } from '@common/constants';

export function headerFilterMiddleware(req: Request, _res: Response, next: NextFunction) {
    for (const key of Object.keys(req.headers)) {
        if (IGNORED_HEADERS.has(key)) {
            delete req.headers[key];
        }
    }

    if (!req.headers['user-agent']) {
        req.socket?.destroy();
        return;
    }

    next();
}

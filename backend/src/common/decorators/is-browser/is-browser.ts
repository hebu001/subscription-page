import { Request } from 'express';

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

const BROWSER_KEYWORDS = [
    'Mozilla',
    'Chrome',
    'Safari',
    'Firefox',
    'Opera',
    'Edge',
    'TelegramBot',
    'WhatsApp',
    'facebookexternalhit',
    'SteamChat',
];

export const IsBrowser = createParamDecorator((data: unknown, ctx: ExecutionContext): boolean => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const userAgent = request.headers['user-agent'];

    if (!userAgent) {
        return false;
    }

    return BROWSER_KEYWORDS.some((keyword) => userAgent.includes(keyword));
});

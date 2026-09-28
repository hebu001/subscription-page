import { Request } from 'express';

import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TypedConfigService } from '@common/config/app-config';
import { IJwtPayload } from '@common/constants';
import {
    isSubscriptionSession,
    selectSubscriptionSession,
    SHORT_UUID_RE,
} from '@common/utils/subscription-session';

@Injectable()
export class PaymentSessionGuard implements CanActivate {
    private readonly allowedOrigins: ReadonlySet<string>;
    private readonly customPrefix: string | undefined;

    constructor(
        private readonly jwtService: JwtService,
        configService: TypedConfigService,
    ) {
        this.allowedOrigins = new Set(configService.get('PAYMENT_ALLOWED_ORIGINS') ?? []);
        this.customPrefix = configService.get('CUSTOM_SUB_PREFIX');
    }

    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{ user?: IJwtPayload } & Request>();
        const requestedShortUuid = request.params.shortUuid;
        if (typeof requestedShortUuid !== 'string' || !SHORT_UUID_RE.test(requestedShortUuid)) {
            throw new UnauthorizedException();
        }
        const { token, scoped } = selectSubscriptionSession(
            request.cookies,
            requestedShortUuid,
            this.customPrefix,
        );

        if (typeof token !== 'string' || token.length === 0) {
            throw new UnauthorizedException();
        }

        let payload: IJwtPayload;
        try {
            payload = await this.jwtService.verifyAsync<IJwtPayload>(token);
        } catch {
            throw new UnauthorizedException();
        }

        if (!isSubscriptionSession(payload)) {
            throw new UnauthorizedException();
        }

        if (requestedShortUuid !== payload.shortUuid) {
            if (scoped) throw new NotFoundException();
            // A expired while B's legacy cookie is fresh: A needs reauthentication.
            throw new UnauthorizedException();
        }

        if (request.method === 'POST') {
            this.assertSameOrigin(request);
        }

        request.user = payload;
        return true;
    }

    private assertSameOrigin(request: Request): void {
        const origin = request.get('origin');
        const fetchSite = request.get('sec-fetch-site');
        const host = request.get('host');

        if (!host) {
            throw new ForbiddenException();
        }

        if (origin) {
            let parsedOrigin: URL;
            try {
                parsedOrigin = new URL(origin);
            } catch {
                throw new ForbiddenException();
            }

            if (origin !== parsedOrigin.origin) {
                throw new ForbiddenException();
            }

            const requestOrigin = `${request.protocol}://${host}`;
            if (
                parsedOrigin.origin !== requestOrigin &&
                !this.allowedOrigins.has(parsedOrigin.origin)
            ) {
                throw new ForbiddenException();
            }
        } else if (fetchSite !== 'same-origin') {
            throw new ForbiddenException();
        }

        if (fetchSite && fetchSite !== 'same-origin') {
            throw new ForbiddenException();
        }
    }
}

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

import { IJwtPayload } from '@common/constants';

const SHORT_UUID_RE = /^[A-Za-z0-9_-]{8,64}$/;

@Injectable()
export class PaymentSessionGuard implements CanActivate {
    constructor(private readonly jwtService: JwtService) {}

    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{ user?: IJwtPayload } & Request>();
        const token = request.cookies?.session;

        if (typeof token !== 'string' || token.length === 0) {
            throw new UnauthorizedException();
        }

        let payload: IJwtPayload;
        try {
            payload = await this.jwtService.verifyAsync<IJwtPayload>(token);
        } catch {
            throw new UnauthorizedException();
        }

        if (
            typeof payload.sessionId !== 'string' ||
            typeof payload.shortUuid !== 'string' ||
            !SHORT_UUID_RE.test(payload.shortUuid) ||
            typeof payload.su !== 'string'
        ) {
            throw new UnauthorizedException();
        }

        const requestedShortUuid = request.params.shortUuid;
        if (requestedShortUuid && requestedShortUuid !== payload.shortUuid) {
            throw new NotFoundException();
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

            if (parsedOrigin.origin !== `${request.protocol}://${host}`) {
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

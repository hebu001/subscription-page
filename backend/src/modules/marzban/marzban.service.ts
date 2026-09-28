import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AxiosService } from '@common/axios/axios.service';
import { TypedConfigService } from '@common/config/app-config';
import { sanitizeUsername } from '@common/utils';
import { safeErrorDiagnostics } from '@common/utils/filter-logs/safe-error';

@Injectable()
export class MarzbanService {
    private readonly logger = new Logger(MarzbanService.name);

    private readonly marzbanSecretKeys: string[];
    private readonly mlDropRevokedSubscriptions: boolean;
    constructor(
        private readonly configService: TypedConfigService,
        private readonly jwtService: JwtService,
        private readonly axiosService: AxiosService,
    ) {
        this.mlDropRevokedSubscriptions = this.configService.getOrThrow(
            'MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS',
        );

        const marzbanSecretKeys = this.configService.get('MARZBAN_LEGACY_SECRET_KEY');

        if (marzbanSecretKeys && marzbanSecretKeys.length > 0) {
            this.marzbanSecretKeys = marzbanSecretKeys.split(',').map((key) => key.trim());
        } else {
            this.marzbanSecretKeys = [];
        }
    }

    public async resolveShortUuid(
        marzbanLink: string,
        clientIp: string,
    ): Promise<{
        dropConnection: boolean;
        shortUuid: string | null;
    }> {
        try {
            const username = await this.tryDecodeMarzbanLink(marzbanLink);

            if (username) {
                const sanitizedUsername = sanitizeUsername(username.username);

                this.logger.log('Marzban subscription link decoded');

                const userInfo = await this.axiosService.getUserByUsername(
                    clientIp,
                    sanitizedUsername,
                );
                if (!userInfo.isOk || !userInfo.response) {
                    this.logger.error('Decoded Marzban user not found in Remnawave');

                    return {
                        dropConnection: true,
                        shortUuid: null,
                    };
                } else if (
                    this.mlDropRevokedSubscriptions &&
                    userInfo.response.response.subRevokedAt !== null
                ) {
                    return {
                        dropConnection: true,
                        shortUuid: null,
                    };
                }

                return {
                    dropConnection: false,
                    shortUuid: userInfo.response.response.shortUuid,
                };
            }

            return {
                dropConnection: false,
                shortUuid: null,
            };
        } catch (error) {
            this.logger.error({
                message: 'Legacy subscription resolution failed',
                ...safeErrorDiagnostics(error),
            });
            return {
                dropConnection: true,
                shortUuid: null,
            };
        }
    }

    private async tryDecodeMarzbanLink(shortUuid: string): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (!this.marzbanSecretKeys.length) return null;

        const token = shortUuid;
        this.logger.debug('Verifying legacy subscription token');

        if (!token || token.length < 10) {
            this.logger.debug('Legacy subscription token too short');
            return null;
        }

        for (const key of this.marzbanSecretKeys) {
            const result = await this.decodeMarzbanLink(shortUuid, key);
            if (result) return result;

            this.logger.debug('Decoding Marzban link failed with a configured key');
        }

        this.logger.debug(`Decoding Marzban link failed with all keys`);

        return null;
    }

    private async decodeMarzbanLink(
        token: string,
        marzbanSecretKey: string,
    ): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (token.split('.').length === 3) {
            try {
                const payload = await this.jwtService.verifyAsync(token, {
                    secret: marzbanSecretKey,
                    algorithms: ['HS256'],
                });

                if (payload.access !== 'subscription') {
                    throw new Error('JWT access field is not subscription');
                }

                const jwtCreatedAt = new Date(payload.iat * 1000);

                if (!this.checkSubscriptionValidity(jwtCreatedAt)) {
                    return null;
                }

                this.logger.debug('Legacy subscription JWT verified');

                return {
                    username: payload.sub,
                    createdAt: jwtCreatedAt,
                };
            } catch (err) {
                this.logger.debug({
                    message: 'Legacy JWT verification failed',
                    ...safeErrorDiagnostics(err),
                });
            }
        }

        const uToken = token.slice(0, token.length - 10);
        const uSignature = token.slice(token.length - 10);

        this.logger.debug('Verifying legacy token signature');

        let decoded: string;
        try {
            decoded = Buffer.from(uToken, 'base64url').toString();
        } catch (err) {
            this.logger.debug({
                message: 'Legacy token decode failed',
                ...safeErrorDiagnostics(err),
            });
            return null;
        }

        const hash = createHash('sha256');
        hash.update(uToken + marzbanSecretKey);
        const digest = hash.digest();

        const expectedSignature = Buffer.from(digest).toString('base64url').slice(0, 10);

        this.logger.debug('Legacy token signature calculated');

        if (uSignature !== expectedSignature) {
            this.logger.debug('Signature mismatch');
            return null;
        }

        const parts = decoded.split(',');
        if (parts.length < 2) {
            this.logger.debug('Invalid legacy token format');
            return null;
        }

        const username = parts[0];
        const createdAtInt = parseInt(parts[1], 10);

        if (isNaN(createdAtInt)) {
            this.logger.debug('Invalid legacy token timestamp');
            return null;
        }

        const createdAt = new Date(createdAtInt * 1000);

        if (!this.checkSubscriptionValidity(createdAt)) {
            return null;
        }

        this.logger.debug('Legacy subscription token decoded');

        return {
            username,
            createdAt,
        };
    }

    private checkSubscriptionValidity(createdAt: Date): boolean {
        const validFrom = this.configService.get('MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM');

        if (!validFrom) {
            return true;
        }

        const validFromDate = new Date(validFrom);
        if (createdAt < validFromDate) {
            this.logger.debug('Legacy subscription predates the configured validity date');

            this.logger.warn('Legacy subscription rejected by validity date');

            return false;
        }

        return true;
    }
}

import type { IncomingHttpHeaders } from 'node:http';

import axios, {
    AxiosError,
    AxiosInstance,
    AxiosResponseHeaders,
    RawAxiosResponseHeaders,
} from 'axios';
import { readPackageJSON } from 'pkg-types';
import { exit } from 'node:process';
import { table } from 'table';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
    GetMetadataCommand,
    GetSubpageConfigByShortUuidCommand,
    GetSubscriptionInfoByShortUuidCommand,
    GetSubscriptionPageConfigCommand,
    GetSubscriptionPageConfigsCommand,
    GetUserByUsernameCommand,
    REMNAWAVE_REAL_IP_HEADER,
    TRequestTemplateTypeKeys,
} from '@remnawave/backend-contract';

import { safeErrorDiagnostics, SafeErrorDiagnostics } from '@common/utils/filter-logs/safe-error';
import { TypedConfigService } from '@common/config/app-config';
import { IGNORED_HEADERS } from '@common/constants';

import { ICommandResponse } from '../types/command-response.type';

@Injectable()
export class AxiosService implements OnModuleInit {
    private readonly logger = new Logger(AxiosService.name);
    private subpageVersion: string;

    public axiosInstance: AxiosInstance;

    constructor(private readonly configService: TypedConfigService) {
        this.axiosInstance = axios.create({
            baseURL: this.configService.getOrThrow('REMNAWAVE_PANEL_URL'),
            timeout: 10_000,
            headers: {
                'user-agent': 'Remnawave Subscription Page',
                'x-subpage-version': this.subpageVersion,
                Authorization: `Bearer ${this.configService.getOrThrow('REMNAWAVE_API_TOKEN')}`,
            },
        });

        const caddyAuthApiToken = this.configService.get('CADDY_AUTH_API_TOKEN');

        const cloudflareZeroTrustClientId = this.configService.get(
            'CLOUDFLARE_ZERO_TRUST_CLIENT_ID',
        );
        const cloudflareZeroTrustClientSecret = this.configService.get(
            'CLOUDFLARE_ZERO_TRUST_CLIENT_SECRET',
        );

        const egamesCookie = this.configService.get('EGAMES_COOKIE');

        if (caddyAuthApiToken) {
            this.axiosInstance.defaults.headers.common['X-Api-Key'] = caddyAuthApiToken;
        }

        if (cloudflareZeroTrustClientId && cloudflareZeroTrustClientSecret) {
            this.axiosInstance.defaults.headers.common['CF-Access-Client-Id'] =
                cloudflareZeroTrustClientId;
            this.axiosInstance.defaults.headers.common['CF-Access-Client-Secret'] =
                cloudflareZeroTrustClientSecret;
        }

        if (this.configService.getOrThrow('REMNAWAVE_PANEL_URL').startsWith('http://')) {
            this.axiosInstance.defaults.headers.common['X-Forwarded-For'] = '127.0.0.1';
            this.axiosInstance.defaults.headers.common['X-Forwarded-Proto'] = 'https';
        }

        if (egamesCookie) {
            this.axiosInstance.defaults.headers.common['Cookie'] = egamesCookie;
        }
    }

    async onModuleInit(): Promise<void> {
        const pkg = await readPackageJSON();

        this.subpageVersion = pkg.version!;

        this.logger.log('Remnawave API client configured');

        const remnawaveMetadata = await this.getRemnawaveMetadata();
        if (!remnawaveMetadata.isOk || !remnawaveMetadata.remnawaveVersion) {
            this.logger.error(
                '\n' +
                    table([['Is the panel online and reachable from this server?']], {
                        header: {
                            content: `Connection to Remnawave Panel failed!`,
                            alignment: 'center',
                        },
                        columnDefault: {
                            width: 70,
                            alignment: 'center',
                            wrapWord: true,
                        },
                        drawVerticalLine: () => false,
                    }) +
                    '\n',
            );
            this.logger.error({
                message: 'Remnawave metadata request failed',
                operation: 'GetMetadata',
                ...remnawaveMetadata.error,
            });

            exit(1);
        } else {
            this.logger.log(`[OK] Connected to Remnawave v${remnawaveMetadata.remnawaveVersion}`);
        }
    }

    public async getRemnawaveMetadata(): Promise<{
        isOk: boolean;
        remnawaveVersion?: string;
        error?: SafeErrorDiagnostics;
    }> {
        try {
            const response = await this.axiosInstance.request<GetMetadataCommand.Response>({
                method: GetMetadataCommand.endpointDetails.REQUEST_METHOD,
                url: GetMetadataCommand.url,
            });

            await GetMetadataCommand.ResponseSchema.parseAsync(response.data);

            return {
                isOk: true,
                remnawaveVersion: response.data.response.version,
            };
        } catch (error) {
            return { isOk: false, error: safeErrorDiagnostics(error) };
        }
    }

    public async getUserByUsername(
        clientIp: string,
        username: string,
    ): Promise<ICommandResponse<GetUserByUsernameCommand.Response>> {
        try {
            const response = await this.axiosInstance.request<GetUserByUsernameCommand.Response>({
                method: GetUserByUsernameCommand.endpointDetails.REQUEST_METHOD,
                url: GetUserByUsernameCommand.url(encodeURIComponent(username)),
                headers: {
                    [REMNAWAVE_REAL_IP_HEADER]: clientIp,
                },
            });

            return {
                isOk: true,
                response: response.data,
            };
        } catch (error) {
            this.logRequestError('GetUserByUsername', error);
            return { isOk: false };
        }
    }

    public async getSubscriptionPageConfigByUuid(
        uuid: string,
    ): Promise<ICommandResponse<GetSubscriptionPageConfigCommand.Response['response']>> {
        try {
            const response =
                await this.axiosInstance.request<GetSubscriptionPageConfigCommand.Response>({
                    method: GetSubscriptionPageConfigCommand.endpointDetails.REQUEST_METHOD,
                    url: GetSubscriptionPageConfigCommand.url(encodeURIComponent(uuid)),
                });

            return {
                isOk: true,
                response: response.data.response,
            };
        } catch (error) {
            this.logRequestError('GetSubscriptionPageConfigByUuid', error);

            return { isOk: false };
        }
    }

    public async getSubscriptionPageConfigList(): Promise<
        ICommandResponse<GetSubscriptionPageConfigsCommand.Response['response']>
    > {
        try {
            const response =
                await this.axiosInstance.request<GetSubscriptionPageConfigsCommand.Response>({
                    method: GetSubscriptionPageConfigsCommand.endpointDetails.REQUEST_METHOD,
                    url: GetSubscriptionPageConfigsCommand.url,
                });

            const validationResult =
                await GetSubscriptionPageConfigsCommand.ResponseSchema.parseAsync(response.data);

            return {
                isOk: true,
                response: validationResult.response,
            };
        } catch (error) {
            this.logRequestError('GetSubscriptionPageConfigList', error);
            if (error instanceof AxiosError && error.response?.status === 404) {
                this.logger.error(
                    'This version of Subscription Page requires Remnawave Panel version >=2.4.0. Please upgrade Remnawave Panel to the latest version or downgrade Subscription Page.',
                );
            }
            return { isOk: false };
        }
    }

    public async getSubscriptionInfo(
        clientIp: string,
        shortUuid: string,
    ): Promise<ICommandResponse<GetSubscriptionInfoByShortUuidCommand.Response>> {
        try {
            const response =
                await this.axiosInstance.request<GetSubscriptionInfoByShortUuidCommand.Response>({
                    method: GetSubscriptionInfoByShortUuidCommand.endpointDetails.REQUEST_METHOD,
                    url: GetSubscriptionInfoByShortUuidCommand.url(encodeURIComponent(shortUuid)),
                    headers: {
                        [REMNAWAVE_REAL_IP_HEADER]: clientIp,
                    },
                });

            return {
                isOk: true,
                response: response.data,
            };
        } catch (error) {
            this.logRequestError('GetSubscriptionInfo', error);
            return { isOk: false };
        }
    }

    public async getSubpageConfig(
        shortUuid: string,
        requestHeaders: IncomingHttpHeaders,
    ): Promise<ICommandResponse<GetSubpageConfigByShortUuidCommand.Response['response']>> {
        try {
            const response =
                await this.axiosInstance.request<GetSubpageConfigByShortUuidCommand.Response>({
                    method: GetSubpageConfigByShortUuidCommand.endpointDetails.REQUEST_METHOD,
                    url: GetSubpageConfigByShortUuidCommand.url(encodeURIComponent(shortUuid)),
                    data: {
                        requestHeaders,
                    },
                });

            return {
                isOk: true,
                response: response.data.response,
            };
        } catch (error) {
            this.logRequestError('GetSubpageConfig', error);
            return { isOk: false };
        }
    }

    public async getSubscription(
        clientIp: string,
        shortUuid: string,
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean = false,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<{
        response: unknown;
        headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
    } | null> {
        try {
            let basePath = 'api/sub/' + encodeURIComponent(shortUuid);

            if (withClientType && clientType) {
                basePath += '/' + encodeURIComponent(clientType);
            }

            const safeHeaders = Object.fromEntries(
                Object.entries(headers).filter(([key]) => !IGNORED_HEADERS.has(key.toLowerCase())),
            );

            const response = await this.axiosInstance.request<unknown>({
                method: 'GET',
                url: basePath,
                headers: {
                    ...safeHeaders,
                    Accept: '*/*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, private, max-age=0',
                    Pragma: 'no-cache',
                    Expires: '0',
                    [REMNAWAVE_REAL_IP_HEADER]: clientIp,
                    Authorization: undefined,
                },
            });

            return {
                response: response.data,
                headers: response.headers,
            };
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 404) return null;
            this.logRequestError('GetSubscription', error);
            return null;
        }
    }

    private logRequestError(operation: string, error: unknown): void {
        this.logger.error({
            message: 'Remnawave request failed',
            operation,
            ...safeErrorDiagnostics(error),
        });
    }
}

import axios, { AxiosError, AxiosInstance } from 'axios';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

import {
    BadGatewayException,
    BadRequestException,
    HttpException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';

import {
    InvoiceResponseSchema,
    InvoiceStatusResponseSchema,
    RenewalOptionsResponseSchema,
    TInvoiceResponse,
    TInvoiceStatusResponse,
    TRenewalOptionsResponse,
} from './payment-bff.schemas';
import { createPaymentBffSignature } from './payment-bff-signature';

type THttpMethod = 'GET' | 'POST';

@Injectable()
export class PaymentBffService {
    private readonly client: AxiosInstance;
    private readonly enabled: boolean;
    private readonly logger = new Logger(PaymentBffService.name);
    private readonly secret: string;
    private readonly upstreamBasePath: string;

    constructor(private readonly configService: TypedConfigService) {
        const upstreamUrl = this.configService.get('PAYMENT_API_URL');
        const secret = this.configService.get('PAYMENT_BFF_SECRET');

        this.enabled = Boolean(upstreamUrl && secret);
        this.secret = secret ?? '';

        const parsedUrl = new URL(upstreamUrl ?? 'https://payment-bff.invalid');
        this.upstreamBasePath = parsedUrl.pathname.replace(/\/$/, '');
        this.client = axios.create({
            baseURL: parsedUrl.toString().replace(/\/$/, ''),
            maxBodyLength: 32 * 1024,
            maxContentLength: 128 * 1024,
            maxRedirects: 0,
            timeout: 10_000,
            transitional: {
                clarifyTimeoutError: true,
            },
        });
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async getRenewalOptions(
        shortUuid: string,
        clientIp: string,
    ): Promise<TRenewalOptionsResponse> {
        return await this.requestUpstream(
            'GET',
            `/${encodeURIComponent(shortUuid)}/renewal-options`,
            clientIp,
            undefined,
            RenewalOptionsResponseSchema,
            shortUuid,
        );
    }

    public async createInvoice(
        shortUuid: string,
        periodDays: number,
        clientIp: string,
    ): Promise<TInvoiceResponse> {
        const options = await this.getRenewalOptions(shortUuid, clientIp);
        const firstMethod = options.methods[0]?.id;

        if (
            !options.enabled ||
            !firstMethod ||
            !options.options.some((option) => option.periodDays === periodDays)
        ) {
            throw new BadRequestException('Unsupported renewal option');
        }

        return await this.requestUpstream(
            'POST',
            `/${encodeURIComponent(shortUuid)}/invoice`,
            clientIp,
            {
                method: firstMethod,
                periodDays,
            },
            InvoiceResponseSchema,
            shortUuid,
        );
    }

    public async getInvoiceStatus(
        shortUuid: string,
        invoiceToken: string,
        clientIp: string,
    ): Promise<TInvoiceStatusResponse> {
        return await this.requestUpstream(
            'GET',
            `/invoice/${encodeURIComponent(invoiceToken)}`,
            clientIp,
            undefined,
            InvoiceStatusResponseSchema,
            shortUuid,
        );
    }

    private async requestUpstream<T>(
        method: THttpMethod,
        relativePath: string,
        clientIp: string,
        body: unknown,
        schema: z.ZodType<T>,
        sessionShortUuid: string,
    ): Promise<T> {
        if (!this.enabled) {
            throw new ServiceUnavailableException();
        }

        const normalizedIp = this.normalizeClientIp(clientIp);
        const serializedBody = body === undefined ? '' : JSON.stringify(body);
        const upstreamPath = `${this.upstreamBasePath}${relativePath}`;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = randomBytes(18).toString('base64url');
        const signature = createPaymentBffSignature({
            body: serializedBody,
            clientIp: normalizedIp,
            method,
            nonce,
            path: upstreamPath,
            secret: this.secret,
            shortUuid: sessionShortUuid,
            timestamp,
        });

        try {
            const response = await this.client.request({
                data: serializedBody || undefined,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Remnawave Subscription Page BFF',
                    'X-Subpage-Client-IP': normalizedIp,
                    'X-Subpage-Nonce': nonce,
                    'X-Subpage-Signature': signature,
                    'X-Subpage-Short-Uuid': sessionShortUuid,
                    'X-Subpage-Timestamp': timestamp,
                },
                method,
                url: relativePath,
            });

            return await schema.parseAsync(response.data);
        } catch (error) {
            if (error instanceof HttpException) throw error;

            if (error instanceof AxiosError) {
                const upstreamStatus = error.response?.status;
                if (
                    upstreamStatus === 400 ||
                    upstreamStatus === 404 ||
                    upstreamStatus === 409 ||
                    upstreamStatus === 429
                ) {
                    throw new HttpException({ statusCode: upstreamStatus }, upstreamStatus);
                }
                this.logger.warn(`Payment API request failed with status ${upstreamStatus ?? 0}`);
            } else if (error instanceof z.ZodError) {
                this.logger.error('Payment API returned an invalid response');
            } else {
                this.logger.error('Payment API request failed');
            }

            throw new BadGatewayException();
        }
    }

    private normalizeClientIp(clientIp: string): string {
        const normalized = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;
        if (!isIP(normalized)) {
            throw new BadRequestException();
        }
        return normalized;
    }
}

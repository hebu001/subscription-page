import { Request, Response } from 'express';

import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { AxiosService } from '@common/axios/axios.service';
import { safeErrorDiagnostics } from '@common/utils/filter-logs/safe-error';
import { setPrivateNoStoreHeaders } from '@common/utils/private-response';

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(private readonly axiosService: AxiosService) {}

    public async serveSubscriptionPage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscription(
                clientIp,
                shortUuid,
                req.headers,
                !!clientType,
                clientType,
            );

            if (!subscriptionDataResponse) {
                res.socket?.destroy();
                return;
            }

            if (subscriptionDataResponse.headers) {
                res.set(subscriptionDataResponse.headers);
            }

            setPrivateNoStoreHeaders(res);
            res.vary('User-Agent');
            res.status(200).send(subscriptionDataResponse.subscription);
            return;
        } catch (error) {
            this.logger.error({
                message: 'Subscription response failed',
                ...safeErrorDiagnostics(error),
            });

            res.socket?.destroy();
            return;
        }
    }
}

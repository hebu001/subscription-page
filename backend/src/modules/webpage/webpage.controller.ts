import { Get, Controller, Header } from '@nestjs/common';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import type { IJwtPayload } from '@common/constants';
import { GetJWTPayload } from '@common/decorators/get-jwt-payload';

import { WebpageService } from './webpage.service';

@Controller()
export class WebpageController {
    constructor(private readonly webpageService: WebpageService) {}

    @Get(APP_CONFIG_ROUTE_WO_LEADING_PATH)
    @Header('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
    @Header('Pragma', 'no-cache')
    @Header('Expires', '0')
    @Header('Surrogate-Control', 'no-store')
    async getSubscriptionPageConfig(@GetJWTPayload() user: IJwtPayload) {
        return await this.webpageService.getSubscriptionPageConfig(user.su);
    }
}

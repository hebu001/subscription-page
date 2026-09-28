import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';

import { WebpageModule } from '@modules/webpage/webpage.module';

import { ClientTypeMiddleware } from './middlewares/client-type.middleware';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
    imports: [WebpageModule],
    controllers: [SubscriptionController],
    providers: [SubscriptionService],
})
export class SubscriptionModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(ClientTypeMiddleware).exclude('/assets/*splat').forRoutes({
            path: ':shortUuid/:clientType',

            method: RequestMethod.GET,
        });
    }
}

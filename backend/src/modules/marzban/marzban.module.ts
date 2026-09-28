import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { getJWTConfig } from '@common/config/jwt/jwt.config';

import { MarzbanMiddleware } from './marzban.middleware';
import { MarzbanService } from './marzban.service';

@Module({
    imports: [JwtModule.registerAsync(getJWTConfig())],
    controllers: [],
    providers: [MarzbanService],
})
export class MarzbanModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(MarzbanMiddleware).exclude('/assets/*splat').forRoutes(
            {
                path: ':shortUuid',
                method: RequestMethod.GET,
            },
            {
                path: ':shortUuid/:clientType',
                method: RequestMethod.GET,
            },
        );
    }
}

process.title = 'rw-subpage';

import { WinstonModule } from 'nest-winston';
import cookieParser from 'cookie-parser';
import { createLogger } from 'winston';
import compression from 'compression';
import * as winston from 'winston';
import { json } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import * as ejs from 'ejs';

import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { checkAssetsCookieMiddleware } from '@common/middlewares/check-assets-cookie.middleware';
import { NotFoundExceptionFilter } from '@common/exception/not-found-exception.filter';
import { createAccessLogMiddleware } from '@common/middlewares/access-log.middleware';
import { isDevelopment, isDevOrDebugLogsEnabled } from '@common/utils/startup-app';
import { noRobotsMiddleware, proxyCheckMiddleware } from '@common/middlewares';
import { getStartMessage } from '@common/utils/startup-app/get-start-message';
import { createLogFormat } from '@common/utils/filter-logs/logger-format';
import { TypedConfigService } from '@common/config/app-config';
import { getRealIp } from '@common/middlewares/get-real-ip';

import { AppModule } from './app.module';

// const levels = {
//     error: 0,
//     warn: 1,
//     info: 2,
//     http: 3,
//     verbose: 4,
//     debug: 5,
//     silly: 6,
// };

const instanceId = process.env.INSTANCE_ID || '0';

const logger = createLogger({
    transports: [new winston.transports.Console()],
    format: createLogFormat(instanceId),
    level: isDevOrDebugLogsEnabled() ? 'debug' : 'http',
});

const assetsPath = isDevelopment()
    ? path.join(__dirname, '..', '..', 'dev_frontend')
    : '/opt/app/frontend';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: WinstonModule.createLogger({
            instance: logger,
        }),
    });

    const config = app.get(TypedConfigService);

    app.disable('x-powered-by');

    app.set('trust proxy', config.getOrThrow('TRUST_PROXY'));

    const customSubPrefix = config.get('CUSTOM_SUB_PREFIX');

    // Install before proxy/static/body-parser middleware, including rejected requests.
    app.use(createAccessLogMiddleware(process.stdout, customSubPrefix));

    app.use(cookieParser());

    app.use(noRobotsMiddleware, proxyCheckMiddleware, checkAssetsCookieMiddleware, getRealIp);

    app.useGlobalFilters(new NotFoundExceptionFilter());

    app.useStaticAssets(assetsPath, {
        index: false,
        dotfiles: 'ignore',
    });

    app.setBaseViewsDir(assetsPath);

    app.engine('html', ejs.renderFile);
    app.setViewEngine('html');

    app.use(json({ limit: '32kb' }));

    const cspEnabled = config.get('CSP_ENABLED');

    app.use(
        helmet({
            contentSecurityPolicy: cspEnabled
                ? {
                      directives: {
                          defaultSrc: ["'self'"],
                          scriptSrc: ["'self'"],
                          // Mantine and injected panel-config SVGs rely on inline styles
                          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
                          // panel subpage config may reference logos/icons on any https host
                          imgSrc: ["'self'", 'data:', 'https:'],
                          connectSrc: ["'self'"],
                          frameAncestors: ["'none'"],
                          objectSrc: ["'none'"],
                          baseUri: ["'self'"],
                          formAction: ["'self'"],
                      },
                  }
                : false,
        }),
    );

    app.use(compression());

    app.setGlobalPrefix(customSubPrefix ?? '', { exclude: [APP_CONFIG_ROUTE_WO_LEADING_PATH] });

    if (customSubPrefix) {
        logger.info('[CONFIG] CUSTOM_SUB_PREFIX: enabled');
    } else {
        logger.info('[CONFIG] CUSTOM_SUB_PREFIX: not set');
    }

    app.enableCors({
        origin: '*',
        methods: 'GET',
        credentials: false,
    });

    app.enableShutdownHooks();

    await app.listen(Number(config.getOrThrow('APP_PORT')));

    logger.info('\n' + (await getStartMessage()) + '\n');
}
void bootstrap();

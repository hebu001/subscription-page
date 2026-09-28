process.title = 'rw-subpage';

import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import path from 'node:path';
import sirv from 'sirv';
import { createLogger } from 'winston';
import * as winston from 'winston';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { TypedConfigService } from '@common/config/app-config';
import { NotFoundExceptionFilter } from '@common/exception/not-found-exception.filter';
import { installRequestMiddleware } from '@common/middlewares/request-pipeline';
import { createLogFormat } from '@common/utils/filter-logs/logger-format';
import { getAssetsPath, isDevOrDebugLogsEnabled } from '@common/utils/startup-app';
import { getStartMessage } from '@common/utils/startup-app/get-start-message';

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

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
        logger: WinstonModule.createLogger({
            instance: logger,
        }),
    });

    const config = app.get(TypedConfigService);

    const customSubPrefix = config.get('CUSTOM_SUB_PREFIX');
    installRequestMiddleware(app, config);

    app.use(
        '/assets',
        sirv(path.join(getAssetsPath(), 'assets'), {
            maxAge: 604800, // 7 days
            immutable: true,
            etag: false,
            // dev: isDevelopment(),
        }),
    );

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

    app.setGlobalPrefix(customSubPrefix ?? '', { exclude: [APP_CONFIG_ROUTE_WO_LEADING_PATH] });

    if (customSubPrefix) {
        logger.info('[CONFIG] CUSTOM_SUB_PREFIX: enabled');
    } else {
        logger.info('[CONFIG] CUSTOM_SUB_PREFIX: not set');
    }

    app.useGlobalFilters(new NotFoundExceptionFilter());

    app.enableCors({
        origin: '*',
        methods: 'GET',
        credentials: false,
    });

    app.enableShutdownHooks();

    await app.listen(Number(config.getOrThrow('APP_PORT')));

    logger.info('\n' + (await getStartMessage()) + '\n');

    if (import.meta.webpackHot) {
        import.meta.webpackHot.accept();
        import.meta.webpackHot.dispose(() => app.close());
    }
}
void bootstrap();

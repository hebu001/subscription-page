import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnvConfig } from '@common/utils/validate-env-config';

import { ConfigSchema, configSchema } from '.';
import { TypedConfigService } from './typed-config.service';

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            cache: true,
            envFilePath: '.env',
            validate: (config) => validateEnvConfig<ConfigSchema>(configSchema, config),
        }),
    ],
    providers: [TypedConfigService],
    exports: [TypedConfigService],
})
export class AppConfigModule {}

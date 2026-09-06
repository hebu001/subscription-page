import { utilities } from 'nest-winston';
import winston from 'winston';

import { customLogFilter } from './filter-logs';

/** Shared by production and regression tests, including the final Nest/Winston formatter. */
export function createLogFormat(instanceId: string, colors = true) {
    return winston.format.combine(
        customLogFilter(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.ms(),
        utilities.format.nestLike(`#${instanceId}`, {
            colors,
            prettyPrint: true,
            processId: false,
            appName: true,
        }),
    );
}

import path from 'node:path';

import { isDevelopment } from './is-development';

export function getAssetsPath(): string {
    return isDevelopment() ? path.resolve(process.cwd(), 'dev_frontend') : '/opt/app/frontend';
}

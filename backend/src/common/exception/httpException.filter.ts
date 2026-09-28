import { Request, Response } from 'express';

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';

import { safeErrorDiagnostics } from '@common/utils/filter-logs/safe-error';

import { HttpExceptionWithErrorCodeType } from './http-exeception-with-error-code.type';

@Catch(HttpExceptionWithErrorCodeType)
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name);

    catch(exception: HttpExceptionWithErrorCodeType, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();
        const status = exception?.getStatus();

        let errorMessage: string | string[];
        let errorCode: string = 'E000';
        if (status === HttpStatus.FORBIDDEN) {
            errorMessage = 'Forbidden';
        } else {
            errorMessage = exception.message;
            if (exception instanceof HttpExceptionWithErrorCodeType) {
                errorCode = exception.errorCode;
            }
        }

        this.logger.error({
            message: 'HTTP request failed',
            status,
            code: errorCode,
            ...safeErrorDiagnostics(exception),
        });
        response.status(status).json({
            timestamp: new Date().toISOString(),
            path: request.url,
            message: errorMessage,
            errorCode,
        });
    }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ResolvedShortUuid = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): string | undefined | null => {
        const request = ctx.switchToHttp().getRequest();
        return request.resolvedShortUuid;
    },
);

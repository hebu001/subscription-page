import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Header,
    Param,
    Post,
    ServiceUnavailableException,
    UseGuards,
} from '@nestjs/common';

import { ClientIp } from '@common/decorators/get-ip';

import { PaymentSessionGuard } from './payment-session.guard';
import { InvoiceRequestSchema } from './payment-bff.schemas';
import { PaymentBffService } from './payment-bff.service';

const SHORT_UUID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const INVOICE_TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;

@UseGuards(PaymentSessionGuard)
@Controller('payment-api')
export class PaymentBffController {
    constructor(private readonly paymentBffService: PaymentBffService) {}

    @Get(':shortUuid/renewal-options')
    @Header('Cache-Control', 'no-store, private, max-age=0')
    @Header('Expires', '0')
    @Header('Pragma', 'no-cache')
    public async getRenewalOptions(
        @ClientIp() clientIp: string,
        @Param('shortUuid') shortUuid: string,
    ) {
        this.assertEnabled();
        this.assertShortUuid(shortUuid);
        return await this.paymentBffService.getRenewalOptions(shortUuid, clientIp);
    }

    @Header('Cache-Control', 'no-store, private, max-age=0')
    @Header('Expires', '0')
    @Header('Pragma', 'no-cache')
    @Post(':shortUuid/invoice')
    public async createInvoice(
        @Body() body: unknown,
        @ClientIp() clientIp: string,
        @Param('shortUuid') shortUuid: string,
    ) {
        this.assertEnabled();
        this.assertShortUuid(shortUuid);

        const parsed = await InvoiceRequestSchema.safeParseAsync(body);
        if (!parsed.success) {
            throw new BadRequestException();
        }

        return await this.paymentBffService.createInvoice(
            shortUuid,
            parsed.data.periodDays,
            clientIp,
        );
    }

    @Get(':shortUuid/invoice/:invoiceToken')
    @Header('Cache-Control', 'no-store, private, max-age=0')
    @Header('Expires', '0')
    @Header('Pragma', 'no-cache')
    public async getInvoiceStatus(
        @ClientIp() clientIp: string,
        @Param('shortUuid') shortUuid: string,
        @Param('invoiceToken') invoiceToken: string,
    ) {
        this.assertEnabled();
        this.assertShortUuid(shortUuid);
        if (!INVOICE_TOKEN_RE.test(invoiceToken)) {
            throw new BadRequestException();
        }
        return await this.paymentBffService.getInvoiceStatus(shortUuid, invoiceToken, clientIp);
    }

    private assertEnabled(): void {
        if (!this.paymentBffService.isEnabled()) {
            throw new ServiceUnavailableException();
        }
    }

    private assertShortUuid(shortUuid: string): void {
        if (!SHORT_UUID_RE.test(shortUuid)) {
            throw new BadRequestException();
        }
    }
}

import { z } from 'zod';

export const RenewalOptionSchema = z.object({
    basePriceKopeks: z.number().int().nonnegative(),
    devicesPriceKopeks: z.number().int().nonnegative(),
    extraDevices: z.number().int().nonnegative(),
    label: z.string().nullable(),
    periodDays: z.number().int().positive().max(3650),
    priceKopeks: z.number().int().positive(),
});

export const RenewalOptionsResponseSchema = z.object({
    cabinetUrl: z.string().url().nullable(),
    currency: z.string().min(1).max(8),
    deviceLimit: z.number().int().nullable(),
    enabled: z.boolean(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    methods: z.array(
        z.object({
            id: z.string().min(1).max(32),
            name: z.string().min(1).max(128),
        }),
    ),
    options: z.array(RenewalOptionSchema),
    tariffName: z.string().max(256).nullable(),
    trafficLimitGb: z.number().int().nullable(),
});

export const InvoiceRequestSchema = z.object({
    periodDays: z.number().int().positive().max(3650),
});

export const InvoiceResponseSchema = z.object({
    amountKopeks: z.number().int().positive(),
    invoiceToken: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/),
    paymentUrl: z
        .string()
        .url()
        .refine((value) => value.startsWith('https://'), {
            message: 'Payment URL must use HTTPS',
        }),
});

export const InvoiceStatusResponseSchema = z.object({
    newExpiresAt: z.string().datetime({ offset: true }).nullable(),
    status: z.enum(['expired', 'failed', 'pending', 'succeeded']),
});

export type TInvoiceResponse = z.infer<typeof InvoiceResponseSchema>;
export type TInvoiceStatusResponse = z.infer<typeof InvoiceStatusResponseSchema>;
export type TRenewalOptionsResponse = z.infer<typeof RenewalOptionsResponseSchema>;

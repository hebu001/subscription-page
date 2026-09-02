import { createHash, createHmac } from 'node:crypto';

interface IPaymentBffSignatureInput {
    body: string;
    clientIp: string;
    method: string;
    nonce: string;
    path: string;
    secret: string;
    shortUuid: string;
    timestamp: string;
}

export const createPaymentBffSignature = ({
    body,
    clientIp,
    method,
    nonce,
    path,
    secret,
    shortUuid,
    timestamp,
}: IPaymentBffSignatureInput): string => {
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const canonical = [timestamp, nonce, shortUuid, clientIp, method, path, bodyHash].join('\n');

    return createHmac('sha256', secret).update(canonical).digest('hex');
};

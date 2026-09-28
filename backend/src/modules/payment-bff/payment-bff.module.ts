import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { getJWTConfig } from '@common/config/jwt/jwt.config';

import { PaymentBffController } from './payment-bff.controller';
import { PaymentBffService } from './payment-bff.service';
import { PaymentSessionGuard } from './payment-session.guard';

@Module({
    imports: [JwtModule.registerAsync(getJWTConfig())],
    controllers: [PaymentBffController],
    providers: [PaymentBffService, PaymentSessionGuard],
})
export class PaymentBffModule {}

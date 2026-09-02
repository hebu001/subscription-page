import { Module } from '@nestjs/common';

import { PaymentBffModule } from './payment-bff/payment-bff.module';
import { RootModule } from './root/root.module';

@Module({
    imports: [PaymentBffModule, RootModule],
})
export class SubscriptionPageBackendModule {}

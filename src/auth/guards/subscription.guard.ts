import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SUBSCRIPTION_KEY } from '../decorators/subscription.decorator';
import { SubscriptionPlan } from 'src/enums/subscriptions.enum';
import { EntitlementService } from 'src/subscription/entitlement.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementService: EntitlementService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlans = this.reflector.getAllAndOverride<SubscriptionPlan[]>(
      REQUIRED_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no subscription restriction is set, grant access
    if (!requiredPlans || requiredPlans.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User authentication context is required for subscription verification.');
    }

    const effectivePlan = this.entitlementService.getEffectivePlan(user);

    if (!effectivePlan || !requiredPlans.includes(effectivePlan)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `This feature requires one of the following subscription plans: ${requiredPlans.join(', ')}. Your current plan is ${effectivePlan ?? 'FREE (Unpaid)'}.`,
          currentPlan: effectivePlan ?? 'FREE',
          requiredPlans,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}

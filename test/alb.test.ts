import { loadBalancerArnFromListener } from '../src/lib/alb';

describe('loadBalancerArnFromListener', () => {
  it('derives the load balancer ARN from an application listener ARN', () => {
    expect(
      loadBalancerArnFromListener(
        'arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/my-alb/1234567890abcdef/fedcba0987654321',
      ),
    ).toBe(
      'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/my-alb/1234567890abcdef',
    );
  });

  it('handles network and gateway load balancers', () => {
    expect(
      loadBalancerArnFromListener(
        'arn:aws:elasticloadbalancing:eu-west-2:111122223333:listener/net/my-nlb/aaaa1111bbbb2222/cccc3333dddd4444',
      ),
    ).toBe(
      'arn:aws:elasticloadbalancing:eu-west-2:111122223333:loadbalancer/net/my-nlb/aaaa1111bbbb2222',
    );
  });

  it('preserves a non-aws partition', () => {
    expect(
      loadBalancerArnFromListener(
        'arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:111122223333:listener/app/gov-alb/1111222233334444/5555666677778888',
      ),
    ).toBe(
      'arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:111122223333:loadbalancer/app/gov-alb/1111222233334444',
    );
  });

  it('returns undefined for a load balancer ARN, so it is not mangled twice', () => {
    expect(
      loadBalancerArnFromListener(
        'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/my-alb/1234567890abcdef',
      ),
    ).toBeUndefined();
  });

  it.each([
    ['a listener rule ARN', 'arn:aws:elasticloadbalancing:us-east-1:111122223333:listener-rule/app/my-alb/1234567890abcdef/fedcba0987654321/1111'],
    ['a target group ARN', 'arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/my-tg/1234567890abcdef'],
    ['an ARN for another service', 'arn:aws:acm:us-east-1:111122223333:certificate/abc'],
    ['not an ARN at all', 'my-alb'],
    ['an empty string', ''],
  ])('returns undefined for %s', (_label, arn) => {
    expect(loadBalancerArnFromListener(arn)).toBeUndefined();
  });
});
